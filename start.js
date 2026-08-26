import { spawn } from "node:child_process";

import { createAuthProxy, LOGIN_PATH } from "./src/auth-proxy.js";
import { readConfig } from "./src/config.js";

const config = readConfig(process.env);

// Railway mounts the persistent volume at /data; override only for local runs.
const dataDir = process.env.PI_WEB_DATA_DIR?.trim() || "/data";

const childEnv = {
  ...process.env,
  HOME: dataDir,
  PI_CODING_AGENT_DIR: `${dataDir}/.pi/agent`,
  // pi-web now sits behind the auth proxy, so it only ever listens on loopback.
  PI_WEB_HOSTNAME: config.upstreamHost,
  PI_WEB_NO_OPEN: "1",
  PORT: String(config.upstreamPort)
};

// pi-web's middleware rejects requests whose Host header is not an allowed
// host. Behind the proxy the Host header still carries the public domain, so
// it has to stay on the allow list.
if (config.allowedHosts.length > 0) {
  childEnv.PI_WEB_ALLOWED_HOSTS = config.allowedHosts.join(",");
}

console.log(`Starting Pi Web on internal port ${config.upstreamPort}`);
console.log(`Auth proxy listening on port ${config.publicPort}`);
console.log(`HOME=${childEnv.HOME}`);
console.log(`PI_CODING_AGENT_DIR=${childEnv.PI_CODING_AGENT_DIR}`);
console.log(`PI_WEB_ALLOWED_HOSTS=${childEnv.PI_WEB_ALLOWED_HOSTS ?? "(unset)"}`);

if (config.authEnabled) {
  console.log(`Form login enabled at ${LOGIN_PATH} (username: ${config.username})`);
  if (!config.sessionSecretFromEnv) {
    console.warn(
      "PI_WEB_SESSION_SECRET is not set. A random secret was generated, so every restart signs users out."
    );
  }
} else {
  console.warn(
    "PI_WEB_PASSWORD is not set. Pi Web is exposed without authentication — set it to enable the login form."
  );
}

const child = spawn(
  "npx",
  [
    "@agegr/pi-web@latest",
    "--hostname",
    config.upstreamHost,
    "--port",
    String(config.upstreamPort),
    "--no-open"
  ],
  {
    stdio: "inherit",
    env: childEnv
  }
);

const { server } = createAuthProxy(config);

server.listen(config.publicPort, "0.0.0.0", () => {
  console.log(`Auth proxy ready on http://0.0.0.0:${config.publicPort}`);
});

server.on("error", error => {
  console.error("Auth proxy failed to start:", error);
  child.kill("SIGTERM");
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);
  server.close();
  child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

child.on("exit", (code, signal) => {
  console.log(`Pi Web exited: code=${code}, signal=${signal}`);
  server.close();
  process.exit(code ?? 1);
});

child.on("error", error => {
  console.error("Failed to start Pi Web:", error);
  server.close();
  process.exit(1);
});
