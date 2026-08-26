import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";

import { createAuthProxy, safeNextPath } from "./auth-proxy.js";
import { buildAllowedHosts, readConfig } from "./config.js";
import { COOKIE_NAME, createSessionManager, parseCookies } from "./session.js";

const PASSWORD = "s3cret-pass";

describe("session manager", () => {
  const sessions = createSessionManager({ secret: "abc", password: PASSWORD, ttlMs: 1000 });

  test("accepts a freshly issued token", () => {
    assert.equal(sessions.verify(sessions.issue().token), true);
  });

  test("rejects tampered and malformed tokens", () => {
    const { token } = sessions.issue();
    assert.equal(sessions.verify(`${token}x`), false);
    assert.equal(sessions.verify("v1.999.nonce"), false);
    assert.equal(sessions.verify(""), false);
    assert.equal(sessions.verify(undefined), false);
  });

  test("rejects expired tokens", () => {
    const now = Date.now();
    const { token } = sessions.issue(now);
    assert.equal(sessions.verify(token, now + 1001), false);
  });

  test("rotating the password invalidates existing tokens", () => {
    const { token } = sessions.issue();
    const rotated = createSessionManager({ secret: "abc", password: "different", ttlMs: 1000 });
    assert.equal(rotated.verify(token), false);
  });
});

describe("safeNextPath", () => {
  test("keeps same-origin paths", () => {
    assert.equal(safeNextPath("/sessions/42?tab=diff"), "/sessions/42?tab=diff");
  });

  test("rejects off-site and auth-loop targets", () => {
    assert.equal(safeNextPath("//evil.example"), "/");
    assert.equal(safeNextPath("https://evil.example"), "/");
    assert.equal(safeNextPath("/__auth/login"), "/");
    assert.equal(safeNextPath(undefined), "/");
  });
});

describe("buildAllowedHosts", () => {
  test("merges configured, Railway and legacy hostname values", () => {
    const hosts = buildAllowedHosts({
      PI_WEB_ALLOWED_HOSTS: "a.example, b.example",
      PI_WEB_HOSTNAME: "0.0.0.0",
      RAILWAY_PUBLIC_DOMAIN: "c.up.railway.app"
    });
    assert.deepEqual(hosts, ["a.example", "b.example", "c.up.railway.app"]);
  });

  test("keeps a public domain passed through PI_WEB_HOSTNAME", () => {
    assert.deepEqual(buildAllowedHosts({ PI_WEB_HOSTNAME: "https://d.example" }), ["d.example"]);
  });
});

describe("auth proxy", () => {
  let upstream;
  let proxy;
  let baseUrl;
  const upstreamRequests = [];

  before(async () => {
    upstream = http.createServer((req, res) => {
      upstreamRequests.push({ url: req.url, headers: req.headers });

      if (req.url === "/sse") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        res.write("data: first\n\n");
        setTimeout(() => {
          res.write("data: second\n\n");
          res.end();
        }, 300);
        return;
      }

      if (req.url === "/needs-auth") {
        res.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
          "Content-Type": "text/plain"
        });
        res.end("Authentication required");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`upstream:${req.headers.authorization ?? "none"}`);
    });
    await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));

    const config = readConfig({
      PORT: "0",
      PI_WEB_PASSWORD: PASSWORD,
      PI_WEB_SESSION_SECRET: "test-secret",
      PI_WEB_INTERNAL_PORT: String(upstream.address().port),
      PI_WEB_INSECURE_COOKIES: "1"
    });
    proxy = createAuthProxy(config, { logger: { warn() {}, error() {} } }).server;
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${proxy.address().port}`;
  });

  after(async () => {
    await new Promise(resolve => proxy.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  });

  async function login() {
    const response = await fetch(`${baseUrl}/__auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "pi", password: PASSWORD, next: "/" })
    });
    const cookie = parseCookies(response.headers.get("set-cookie"));
    return { response, cookieHeader: `${COOKIE_NAME}=${cookie[COOKIE_NAME]}` };
  }

  test("serves an in-page login form instead of a Basic Auth challenge", async () => {
    const response = await fetch(`${baseUrl}/__auth/login`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("www-authenticate"), null);
    assert.match(body, /<form method="post" action="\/__auth\/login"/);
    assert.match(body, /name="password"/);
  });

  test("redirects unauthenticated page requests to the login form", async () => {
    const response = await fetch(`${baseUrl}/sessions/7`, {
      redirect: "manual",
      headers: { Accept: "text/html" }
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/__auth/login?next=%2Fsessions%2F7");
    assert.equal(response.headers.get("www-authenticate"), null);
  });

  test("answers unauthenticated API requests with JSON, not a challenge", async () => {
    const response = await fetch(`${baseUrl}/api/sessions`);

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), null);
    assert.deepEqual(await response.json(), {
      error: "Authentication required",
      loginUrl: "/__auth/login"
    });
  });

  test("rejects a wrong password without issuing a cookie", async () => {
    const response = await fetch(`${baseUrl}/__auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "pi", password: "wrong", next: "/" })
    });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(await response.text(), /Incorrect username or password/);
  });

  test("rejects a cross-origin login submission", async () => {
    const response = await fetch(`${baseUrl}/__auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://evil.example"
      },
      body: new URLSearchParams({ username: "pi", password: PASSWORD, next: "/" })
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  test("issues an HttpOnly session cookie on a correct password", async () => {
    const { response } = await login();
    const setCookie = response.headers.get("set-cookie");

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
  });

  test("proxies authenticated requests with Basic credentials injected", async () => {
    const { cookieHeader } = await login();
    const response = await fetch(`${baseUrl}/api/sessions`, { headers: { Cookie: cookieHeader } });

    const expected = `Basic ${Buffer.from(`pi:${PASSWORD}`).toString("base64")}`;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `upstream:${expected}`);
  });

  test("never forwards a client-supplied Authorization header upstream", async () => {
    const { cookieHeader } = await login();
    await fetch(`${baseUrl}/api/sessions`, {
      headers: { Cookie: cookieHeader, Authorization: "Basic ZXZpbDpldmls" }
    });

    const last = upstreamRequests.at(-1);
    assert.equal(last.headers.authorization, `Basic ${Buffer.from(`pi:${PASSWORD}`).toString("base64")}`);
  });

  test("streams server-sent events through without buffering", async () => {
    const { cookieHeader } = await login();
    const response = await fetch(`${baseUrl}/sse`, { headers: { Cookie: cookieHeader } });
    const reader = response.body.getReader();

    const started = Date.now();
    const first = new TextDecoder().decode((await reader.read()).value);
    const firstChunkDelay = Date.now() - started;

    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(first, "data: first\n\n");
    // The upstream holds the response open for 300ms; a buffering proxy would
    // not surface the first event until then.
    assert.ok(firstChunkDelay < 200, `first chunk took ${firstChunkDelay}ms`);

    await reader.cancel();
  });

  test("strips WWW-Authenticate from upstream responses", async () => {
    const { cookieHeader } = await login();
    const response = await fetch(`${baseUrl}/needs-auth`, { headers: { Cookie: cookieHeader } });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), null);
  });

  test("logging out clears the cookie and blocks further access", async () => {
    const { cookieHeader } = await login();
    const response = await fetch(`${baseUrl}/__auth/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookieHeader }
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/__auth/login");
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  });

  test("health check answers without a session", async () => {
    const response = await fetch(`${baseUrl}/__auth/healthz`);
    assert.deepEqual(await response.json(), { status: "ok", authEnabled: true });
  });
});
