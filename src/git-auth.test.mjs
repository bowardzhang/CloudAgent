import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { configureGitAuth, readGitAuthEnv, tokenEnv } from "./git-auth.js";

const TOKEN = "ghp_exampleTokenValue1234567890";

describe("readGitAuthEnv", () => {
  test("prefers GITHUB_TOKEN and falls back to GH_TOKEN", () => {
    assert.equal(readGitAuthEnv({ GITHUB_TOKEN: "a", GH_TOKEN: "b" }).token, "a");
    assert.equal(readGitAuthEnv({ GH_TOKEN: "b" }).token, "b");
    assert.equal(readGitAuthEnv({}).token, "");
  });

  test("trims surrounding whitespace", () => {
    assert.deepEqual(readGitAuthEnv({ GITHUB_TOKEN: "  a  ", GIT_USER_NAME: " Ada " }), {
      token: "a",
      userName: "Ada",
      userEmail: ""
    });
  });
});

describe("tokenEnv", () => {
  test("exports both names git and the GitHub CLI look for", () => {
    assert.deepEqual(tokenEnv(TOKEN), { GITHUB_TOKEN: TOKEN, GH_TOKEN: TOKEN });
  });

  test("exports nothing without a token", () => {
    assert.deepEqual(tokenEnv(""), {});
  });
});

describe("configureGitAuth", () => {
  let dir;
  let configPath;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-auth-"));
    configPath = path.join(dir, ".gitconfig");
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function get(key) {
    return execFileSync("git", ["config", "--file", configPath, "--get", key], {
      encoding: "utf8"
    }).trim();
  }

  function getAll(key) {
    return execFileSync("git", ["config", "--file", configPath, "--get-all", key], {
      encoding: "utf8"
    })
      .trim()
      .split("\n");
  }

  function fillCredential(host, env = {}) {
    return execFileSync("git", ["credential", "fill"], {
      input: `protocol=https\nhost=${host}\n\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: dir,
        GIT_CONFIG_GLOBAL: configPath,
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GITHUB_TOKEN: TOKEN,
        ...env
      }
    });
  }

  test("configures the helper, URL rewrite and identity", () => {
    const configured = configureGitAuth({
      configPath,
      token: TOKEN,
      userName: "Ada Lovelace",
      userEmail: "ada@example.com"
    });

    assert.deepEqual(configured, [
      "github credential helper",
      "ssh-to-https rewrite",
      "user.name",
      "user.email"
    ]);
    assert.match(get("credential.https://github.com.helper"), /^!f\(\)/);
    assert.equal(get("user.name"), "Ada Lovelace");
    assert.equal(get("user.email"), "ada@example.com");
    assert.deepEqual(getAll("url.https://github.com/.insteadOf"), [
      "git@github.com:",
      "ssh://git@github.com/"
    ]);
  });

  test("never writes the token to disk", () => {
    assert.equal(fs.readFileSync(configPath, "utf8").includes(TOKEN), false);
  });

  test("is idempotent across restarts", () => {
    for (let i = 0; i < 3; i += 1) {
      configureGitAuth({ configPath, token: TOKEN, userName: "Ada Lovelace" });
    }

    assert.deepEqual(getAll("url.https://github.com/.insteadOf"), [
      "git@github.com:",
      "ssh://git@github.com/"
    ]);
    assert.deepEqual(getAll("credential.https://github.com.helper").length, 1);
    assert.deepEqual(getAll("user.name"), ["Ada Lovelace"]);
  });

  test("preserves unrelated settings already in the file", () => {
    execFileSync("git", ["config", "--file", configPath, "core.editor", "vim"]);
    configureGitAuth({ configPath, token: TOKEN });

    assert.equal(get("core.editor"), "vim");
  });

  test("git resolves GitHub credentials from the environment", () => {
    const output = fillCredential("github.com");

    assert.match(output, /^username=x-access-token$/m);
    assert.match(output, new RegExp(`^password=${TOKEN}$`, "m"));
  });

  test("the token follows the environment, not the config file", () => {
    const output = fillCredential("github.com", { GITHUB_TOKEN: "rotated-token" });

    assert.match(output, /^password=rotated-token$/m);
  });

  test("does not hand the token to other hosts", () => {
    let output = "";
    try {
      output = fillCredential("gitlab.com");
    } catch (error) {
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }

    assert.equal(output.includes(TOKEN), false);
  });

  test("configures nothing without a token", () => {
    const emptyPath = path.join(dir, "empty.gitconfig");

    assert.deepEqual(configureGitAuth({ configPath: emptyPath, token: "" }), []);
    assert.equal(fs.existsSync(emptyPath), false);
  });
});
