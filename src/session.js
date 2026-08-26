import crypto from "node:crypto";

export const COOKIE_NAME = "pi_web_session";

const TOKEN_VERSION = "v1";

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time comparison that tolerates differing lengths by hashing first.
 */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== "string") return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name === "") continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function createSessionManager({ secret, password, ttlMs }) {
  // Folding the password into the signing key means rotating PI_WEB_PASSWORD
  // invalidates every outstanding session for free.
  const key = crypto
    .createHmac("sha256", secret)
    .update("pi-web-session")
    .update(sha256(password ?? ""))
    .digest();

  function sign(payload) {
    return crypto.createHmac("sha256", key).update(payload).digest("base64url");
  }

  function issue(now = Date.now()) {
    const expiresAt = now + ttlMs;
    const nonce = crypto.randomBytes(12).toString("base64url");
    const payload = `${TOKEN_VERSION}.${expiresAt}.${nonce}`;
    return { token: `${payload}.${sign(payload)}`, expiresAt };
  }

  function verify(token, now = Date.now()) {
    if (typeof token !== "string") return false;

    const parts = token.split(".");
    if (parts.length !== 4) return false;

    const [version, expiresAt, , signature] = parts;
    if (version !== TOKEN_VERSION) return false;
    if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= now) return false;

    return safeEqual(sign(parts.slice(0, 3).join(".")), signature);
  }

  return { issue, verify, ttlMs };
}

export function buildSetCookie(token, { maxAgeMs, secure }) {
  const attributes = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildClearCookie({ secure }) {
  const attributes = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
