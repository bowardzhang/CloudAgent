import http from "node:http";

import { renderLoginPage, renderMessagePage } from "./login-page.js";
import {
  COOKIE_NAME,
  buildClearCookie,
  buildSetCookie,
  createSessionManager,
  parseCookies,
  safeEqual
} from "./session.js";

export const AUTH_BASE = "/__auth";
export const LOGIN_PATH = `${AUTH_BASE}/login`;
export const LOGOUT_PATH = `${AUTH_BASE}/logout`;
export const HEALTH_PATH = `${AUTH_BASE}/healthz`;

// Headers that describe a single hop and must not be forwarded verbatim.
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
];

const MAX_LOGIN_BODY_BYTES = 4096;
const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export function createRateLimiter({
  limit = LOGIN_ATTEMPT_LIMIT,
  windowMs = LOGIN_ATTEMPT_WINDOW_MS
} = {}) {
  const buckets = new Map();

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    check(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) return true;
      return bucket.count < limit;
    },
    fail(key, now = Date.now()) {
      prune(now);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return;
      }
      bucket.count += 1;
    },
    reset(key) {
      buckets.delete(key);
    }
  };
}

function stripHeaders(headers, names) {
  const copy = { ...headers };
  for (const name of names) delete copy[name];
  return copy;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function wantsHtml(req) {
  const accept = req.headers.accept;
  return typeof accept === "string" && accept.includes("text/html");
}

/**
 * Only same-origin absolute paths are accepted, so a crafted ?next= cannot
 * bounce a freshly signed-in user off to another site.
 */
export function safeNextPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value === AUTH_BASE || value.startsWith(`${AUTH_BASE}/`)) return "/";
  return value;
}

function isSameOriginPost(req) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return true;

  const host = req.headers.host;
  if (typeof host !== "string" || host === "") return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readBody(req, limit = MAX_LOGIN_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createAuthProxy(config, { logger = console } = {}) {
  const sessions = createSessionManager({
    secret: config.sessionSecret,
    password: config.password,
    ttlMs: config.sessionTtlMs
  });
  const rateLimiter = createRateLimiter();

  const upstreamAuthorization = config.authEnabled
    ? `Basic ${Buffer.from(`${config.upstreamUsername}:${config.password}`, "utf8").toString("base64")}`
    : null;

  function isSecureRequest(req) {
    if (!config.trustForwardedProto) return false;
    const proto = req.headers["x-forwarded-proto"];
    if (typeof proto === "string" && proto.trim() !== "") {
      return proto.split(",")[0].trim() === "https";
    }
    return Boolean(req.socket.encrypted);
  }

  function isAuthenticated(req) {
    if (!config.authEnabled) return true;
    const cookies = parseCookies(req.headers.cookie);
    return sessions.verify(cookies[COOKIE_NAME]);
  }

  function sendHtml(req, res, status, html, extraHeaders = {}) {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(html),
      ...extraHeaders
    });
    res.end(req.method === "HEAD" ? undefined : html);
  }

  function sendLoginPage(req, res, { status = 200, error = "", next = "/" } = {}) {
    sendHtml(
      req,
      res,
      status,
      renderLoginPage({
        title: config.loginTitle,
        loginPath: LOGIN_PATH,
        next: safeNextPath(next),
        username: config.username,
        error
      })
    );
  }

  function redirect(res, location, extraHeaders = {}) {
    res.writeHead(303, { Location: location, "Cache-Control": "no-store", ...extraHeaders });
    res.end();
  }

  async function handleLogin(req, res, url) {
    if (req.method === "GET" || req.method === "HEAD") {
      if (isAuthenticated(req)) {
        redirect(res, safeNextPath(url.searchParams.get("next") ?? "/"));
        return;
      }
      sendLoginPage(req, res, { next: url.searchParams.get("next") ?? "/" });
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "GET, POST", "Cache-Control": "no-store" });
      res.end("Method Not Allowed");
      return;
    }

    if (!isSameOriginPost(req)) {
      sendLoginPage(req, res, { status: 403, error: "Request blocked: cross-origin form submission." });
      return;
    }

    let form;
    try {
      form = new URLSearchParams(await readBody(req));
    } catch {
      sendLoginPage(req, res, { status: 413, error: "Submitted form was too large." });
      return;
    }

    const next = safeNextPath(form.get("next") ?? "/");
    const ip = clientIp(req);

    if (!rateLimiter.check(ip)) {
      sendLoginPage(req, res, {
        status: 429,
        next,
        error: "Too many failed attempts. Please wait a few minutes and try again."
      });
      return;
    }

    const usernameOk = safeEqual(form.get("username") ?? "", config.username);
    const passwordOk = safeEqual(form.get("password") ?? "", config.password);

    if (!usernameOk || !passwordOk) {
      rateLimiter.fail(ip);
      logger.warn(`Failed login attempt from ${ip}`);
      sendLoginPage(req, res, { status: 401, next, error: "Incorrect username or password." });
      return;
    }

    rateLimiter.reset(ip);
    const { token } = sessions.issue();
    redirect(res, next, {
      "Set-Cookie": buildSetCookie(token, {
        maxAgeMs: sessions.ttlMs,
        secure: isSecureRequest(req)
      })
    });
  }

  function handleLogout(req, res) {
    if (req.method === "POST" && !isSameOriginPost(req)) {
      res.writeHead(403, { "Cache-Control": "no-store" });
      res.end("Forbidden");
      return;
    }

    redirect(res, LOGIN_PATH, {
      "Set-Cookie": buildClearCookie({ secure: isSecureRequest(req) })
    });
  }

  function proxyRequest(req, res) {
    const headers = stripHeaders(req.headers, [...HOP_BY_HOP_HEADERS, "authorization"]);
    if (upstreamAuthorization) headers.authorization = upstreamAuthorization;

    const upstreamReq = http.request(
      {
        host: config.upstreamHost,
        port: config.upstreamPort,
        method: req.method,
        path: req.url,
        headers
      },
      upstreamRes => {
        // Dropping WWW-Authenticate is what keeps the browser's native Basic
        // Auth dialog from ever surfacing, even if upstream answers 401.
        const responseHeaders = stripHeaders(upstreamRes.headers, [
          ...HOP_BY_HOP_HEADERS,
          "www-authenticate"
        ]);
        res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
        // Server-sent events must not sit in a buffer waiting for more bytes.
        res.flushHeaders();
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.setNoDelay(true);
    upstreamReq.on("error", error => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error.code === "ECONNREFUSED" && wantsHtml(req)) {
        sendHtml(
          req,
          res,
          503,
          renderMessagePage({
            title: config.loginTitle,
            heading: "Starting up",
            message: "Pi Web is still booting. This page refreshes automatically.",
            refreshSeconds: 3
          }),
          { "Retry-After": "3" }
        );
        return;
      }
      logger.error(`Upstream request failed: ${error.message}`);
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Bad Gateway");
    });

    res.on("close", () => upstreamReq.destroy());
    req.pipe(upstreamReq);
  }

  function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      res.writeHead(400, { "Cache-Control": "no-store" });
      res.end("Bad Request");
      return;
    }

    if (url.pathname === HEALTH_PATH) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ status: "ok", authEnabled: config.authEnabled }));
      return;
    }

    if (config.authEnabled && url.pathname === LOGIN_PATH) {
      handleLogin(req, res, url).catch(error => {
        logger.error(`Login handler failed: ${error.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Cache-Control": "no-store" });
          res.end("Internal Server Error");
        }
      });
      return;
    }

    if (config.authEnabled && url.pathname === LOGOUT_PATH) {
      handleLogout(req, res);
      return;
    }

    if (!isAuthenticated(req)) {
      if (wantsHtml(req) && (req.method === "GET" || req.method === "HEAD")) {
        redirect(res, `${LOGIN_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`);
        return;
      }
      res.writeHead(401, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Pi-Web-Auth": "required"
      });
      res.end(JSON.stringify({ error: "Authentication required", loginUrl: LOGIN_PATH }));
      return;
    }

    proxyRequest(req, res);
  }

  function handleUpgrade(req, socket, head) {
    if (!isAuthenticated(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const headers = stripHeaders(req.headers, ["authorization"]);
    if (upstreamAuthorization) headers.authorization = upstreamAuthorization;

    const upstreamReq = http.request({
      host: config.upstreamHost,
      port: config.upstreamPort,
      method: req.method,
      path: req.url,
      headers
    });

    upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      const statusLine = [
        `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`,
        ...Object.entries(upstreamRes.headers).flatMap(([name, value]) =>
          Array.isArray(value) ? value.map(item => `${name}: ${item}`) : [`${name}: ${value}`]
        ),
        "",
        ""
      ].join("\r\n");

      socket.write(statusLine);
      if (upstreamHead?.length) upstreamSocket.unshift(upstreamHead);
      upstreamSocket.setNoDelay(true);
      socket.setNoDelay(true);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });

    upstreamReq.on("error", () => socket.destroy());
    socket.on("error", () => upstreamReq.destroy());

    if (head?.length) upstreamReq.write(head);
    upstreamReq.end();
  }

  const server = http.createServer(handleRequest);
  server.on("upgrade", handleUpgrade);
  // Long-lived SSE streams must not be cut short by the default timeouts.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 76_000;

  return { server, sessions, handleRequest };
}
