import { spawn } from "node:child_process";

const home = process.env.HOME || "/data";

const env = {
  ...process.env,

  HOME: home,

  PI_CODING_AGENT_DIR:
    process.env.PI_CODING_AGENT_DIR || "/data/.pi/agent",

  PI_WEB_HOSTNAME:
    process.env.PI_WEB_HOSTNAME || "0.0.0.0",

  PI_WEB_NO_OPEN: "1"
};

const child = spawn(
  "npx",
  [
    "@agegr/pi-web@latest",
    "--hostname",
    "0.0.0.0",
    "--port",
    process.env.PORT || "30141",
    "--no-open"
  ],
  {
    stdio: "inherit",
    env
  }
);

child.on("exit", code => {
  process.exit(code ?? 1);
});
