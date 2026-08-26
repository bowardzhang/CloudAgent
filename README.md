# CloudAgent

Railway deployment wrapper for [pi-web](https://github.com/agegr/pi-web), the web UI for the
pi coding agent.

`start.js` runs pi-web on a loopback-only internal port and puts a small authentication proxy
in front of it on Railway's `$PORT`. The proxy serves an in-page login form instead of pi-web's
built-in HTTP Basic Auth, which the browser can only render as a native popup.

## How the login works

1. Any unauthenticated request for a page is redirected to `/__auth/login`.
2. Submitting the form checks the credentials in constant time and sets a signed, `HttpOnly`,
   `SameSite=Lax` session cookie.
3. Every subsequent request is proxied to pi-web with `Authorization: Basic pi:<password>`
   injected, so pi-web stays protected by its own middleware.
4. `WWW-Authenticate` is stripped from all upstream responses, so the browser popup never appears.

`POST /__auth/logout` clears the session. `GET /__auth/healthz` is unauthenticated and answers
`{"status":"ok"}` — useful as a Railway health check.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PI_WEB_PASSWORD` | yes | — | Login password. **When unset, the app is served with no authentication at all.** |
| `PI_WEB_SESSION_SECRET` | recommended | random per boot | HMAC key for session cookies. Without it every restart signs everyone out. |
| `PI_WEB_ALLOWED_HOSTS` | see below | — | Comma-separated public hostnames. pi-web rejects requests whose `Host` header is not allowed. |
| `PI_WEB_USERNAME` | no | `pi` | Username the login form expects. pi-web upstream always receives `pi`. |
| `PI_WEB_SESSION_TTL_HOURS` | no | `168` | Session lifetime. |
| `PI_WEB_INTERNAL_PORT` | no | `30142` | Loopback port pi-web listens on. |
| `PI_WEB_LOGIN_TITLE` | no | `Pi Web` | Heading shown on the login page. |
| `PI_WEB_INSECURE_COOKIES` | no | unset | Set to `1` to drop the `Secure` cookie flag (local HTTP testing only). |
| `PI_WEB_DATA_DIR` | no | `/data` | Home/state directory for the agent; Railway's volume mount point. |
| `PORT` | set by Railway | `30141` | Public port the auth proxy binds. |

On Railway, `RAILWAY_PUBLIC_DOMAIN` is picked up automatically and added to the allowed hosts, so
`PI_WEB_ALLOWED_HOSTS` only needs to be set for custom domains. A public domain previously
configured through `PI_WEB_HOSTNAME` is still honoured.

Rotating `PI_WEB_PASSWORD` invalidates all existing sessions, because the password is folded into
the cookie signing key.

## GitHub access for the agent

Set `GITHUB_TOKEN` to a GitHub Personal Access Token in the Railway service variables. On every
boot `start.js` writes `$PI_WEB_DATA_DIR/.gitconfig` (i.e. `~/.gitconfig`) with:

- a credential helper scoped to `https://github.com` that reads the token from the environment,
- `insteadOf` rewrites so `git@github.com:` and `ssh://git@github.com/` remotes use HTTPS too.

This gives the agent GitHub access that is global (a `~/.gitconfig`, so every repository and every
session sees it) and durable (rebuilt from the environment at startup, so it survives restarts and
redeploys even without a mounted volume).

**The token is never written to disk.** The helper interpolates `$GITHUB_TOKEN` at call time, so
the config file holds only the shell snippet. Rotating the token in Railway takes effect on the
next deploy with no file to clean up.

`GH_TOKEN` is exported alongside `GITHUB_TOKEN`, so the GitHub CLI authenticates without
`gh auth login` if you add `gh` to the image. Set `GIT_USER_NAME` and `GIT_USER_EMAIL` as well, or
`git commit` fails with "Please tell me who you are".

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` (or `GH_TOKEN`) | Personal Access Token used for GitHub HTTPS auth. |
| `GIT_USER_NAME` | `user.name` for commits. |
| `GIT_USER_EMAIL` | `user.email` for commits. |

Scope the token narrowly: a fine-grained token limited to the repositories the agent needs, with
Contents and Pull requests read/write plus Metadata read, and an expiry date. The agent runs shell
commands on your behalf, so anything it executes can read `$GITHUB_TOKEN` — treat the token's blast
radius as the agent's blast radius.

## Local development

```sh
npm install
npm test                                    # unit + proxy integration tests
PI_WEB_PASSWORD=dev PI_WEB_INSECURE_COOKIES=1 PI_WEB_DATA_DIR="$PWD/.data" PORT=30141 npm start
```
