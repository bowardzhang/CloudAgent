import { spawn } from "node:child_process";

const env = {
  ...process.env,
  HOME: "/data",
  PI_CODING_AGENT_DIR: "/data/.pi/agent",
  PI_WEB_HOSTNAME: "0.0.0.0",
  PI_WEB_NO_OPEN: "1"
};

const port = process.env.PORT || "30141";

console.log(`Starting Pi Web on port ${port}`);
console.log(`HOME=${env.HOME}`);
console.log(`PI_CODING_AGENT_DIR=${env.PI_CODING_AGENT_DIR}`);

const child = spawn(
  "npx",
  [
    "@agegr/pi-web@latest",
    "--hostname",
    "0.0.0.0",
    "--port",
    port,
    "--no-open"
  ],
  {
    stdio: "inherit",
    env
  }
);

child.on("exit", (code, signal) => {
  console.log(`Pi Web exited: code=${code}, signal=${signal}`);
  process.exit(code ?? 1);
});

child.on("error", error => {
  console.error("Failed to start Pi Web:", error);
  process.exit(1);
});
