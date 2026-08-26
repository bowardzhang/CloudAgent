import { execFileSync } from "node:child_process";

/**
 * Credential helper that answers from the environment at call time, so the
 * token itself is never written to the config file (or the volume).
 */
const GITHUB_CREDENTIAL_HELPER =
  '!f() { if [ "$1" = get ]; then echo username=x-access-token; echo "password=$GITHUB_TOKEN"; fi; }; f';

const SSH_URL_PREFIXES = ["git@github.com:", "ssh://git@github.com/"];

function runGitConfig(file, args) {
  execFileSync("git", ["config", "--file", file, ...args], { stdio: "pipe" });
}

function unsetAll(file, key) {
  try {
    runGitConfig(file, ["--unset-all", key]);
  } catch {
    // Exit code 5 means the key was not set yet, which is the common case.
  }
}

/**
 * Writes the managed GitHub credential settings into `configPath`.
 *
 * `git config --file` merges into an existing file rather than replacing it,
 * so hand-written settings in the same config survive. Every run replaces the
 * managed keys outright, which keeps repeated boots idempotent.
 */
export function configureGitAuth({ configPath, token, userName, userEmail }) {
  const configured = [];

  if (token) {
    runGitConfig(configPath, [
      "--replace-all",
      "credential.https://github.com.helper",
      GITHUB_CREDENTIAL_HELPER
    ]);
    configured.push("github credential helper");

    // Lets SSH-style remotes authenticate with the same token, so a cloned or
    // pasted git@github.com: URL does not need a key pair.
    unsetAll(configPath, "url.https://github.com/.insteadOf");
    for (const prefix of SSH_URL_PREFIXES) {
      runGitConfig(configPath, ["--add", "url.https://github.com/.insteadOf", prefix]);
    }
    configured.push("ssh-to-https rewrite");
  }

  if (userName) {
    runGitConfig(configPath, ["--replace-all", "user.name", userName]);
    configured.push("user.name");
  }

  if (userEmail) {
    runGitConfig(configPath, ["--replace-all", "user.email", userEmail]);
    configured.push("user.email");
  }

  return configured;
}

export function readGitAuthEnv(env = process.env) {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim() || "";
  return {
    token,
    userName: env.GIT_USER_NAME?.trim() || "",
    userEmail: env.GIT_USER_EMAIL?.trim() || ""
  };
}

/**
 * Both names are exported to the agent's environment: git's helper reads
 * GITHUB_TOKEN, the GitHub CLI reads either.
 */
export function tokenEnv(token) {
  return token ? { GITHUB_TOKEN: token, GH_TOKEN: token } : {};
}
