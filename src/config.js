import crypto from "node:crypto";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function positiveInt(value, fallback) {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hostOf(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const raw = value.trim();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host;
  } catch {
    return null;
  }
}

/**
 * pi-web's middleware rejects requests whose Host header is neither a
 * loopback/IP host nor listed in PI_WEB_HOSTNAME / PI_WEB_ALLOWED_HOSTS. Now
 * that pi-web binds to 127.0.0.1 behind the proxy, the public hostname has to
 * be carried over explicitly, so fold in whatever Railway tells us about the
 * public domain.
 */
const BIND_ONLY_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "localhost", "::", "::1", "[::]", "[::1]"]);

export function buildAllowedHosts(env) {
  const candidates = [
    ...(env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
    // Deployments that previously used PI_WEB_HOSTNAME to allow their public
    // domain keep working: the proxy owns the bind address now, but the domain
    // still has to reach the allow list.
    BIND_ONLY_HOSTS.has(env.PI_WEB_HOSTNAME?.trim() ?? "") ? null : env.PI_WEB_HOSTNAME,
    env.RAILWAY_PUBLIC_DOMAIN,
    env.RAILWAY_STATIC_URL,
    env.PI_WEB_PUBLIC_HOST
  ];

  const hosts = [];
  for (const candidate of candidates) {
    const host = hostOf(candidate);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

export function readConfig(env = process.env) {
  const password = typeof env.PI_WEB_PASSWORD === "string" ? env.PI_WEB_PASSWORD : "";
  const authEnabled = password.length > 0;

  return {
    publicPort: positiveInt(env.PORT, 30141),
    upstreamHost: "127.0.0.1",
    upstreamPort: positiveInt(env.PI_WEB_INTERNAL_PORT, 30142),
    allowedHosts: buildAllowedHosts(env),
    authEnabled,
    password,
    // pi-web hardcodes "pi" as the Basic Auth username upstream; the form can
    // ask for a friendlier one without the upstream ever knowing.
    username: env.PI_WEB_USERNAME?.trim() || "pi",
    upstreamUsername: "pi",
    sessionSecret: env.PI_WEB_SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    sessionSecretFromEnv: Boolean(env.PI_WEB_SESSION_SECRET),
    sessionTtlMs: positiveInt(env.PI_WEB_SESSION_TTL_HOURS, 168) * 60 * 60 * 1000,
    loginTitle: env.PI_WEB_LOGIN_TITLE?.trim() || "Pi Web",
    trustForwardedProto: !isEnabled(env.PI_WEB_INSECURE_COOKIES)
  };
}
