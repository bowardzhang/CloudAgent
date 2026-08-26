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

## Local development

```sh
npm install
npm test                                    # unit + proxy integration tests
PI_WEB_PASSWORD=dev PI_WEB_INSECURE_COOKIES=1 PI_WEB_DATA_DIR="$PWD/.data" PORT=30141 npm start
```
