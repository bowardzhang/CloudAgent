const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ESCAPES[character]);
}

export function renderLoginPage({ title, loginPath, next = "/", username = "pi", error = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Sign in · ${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f6f7;
    --card: #ffffff;
    --border: #e2e2e5;
    --text: #18181b;
    --muted: #6b6b76;
    --accent: #3d5afe;
    --accent-text: #ffffff;
    --error-bg: #fdecec;
    --error-border: #f3bcbc;
    --error-text: #9a1c1c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e0e11;
      --card: #17171b;
      --border: #2a2a31;
      --text: #f2f2f4;
      --muted: #9a9aa5;
      --accent: #7a8bff;
      --accent-text: #0e0e11;
      --error-bg: #2c1618;
      --error-border: #5a2427;
      --error-text: #ff9d9d;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  main {
    width: 100%;
    max-width: 360px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 28px 24px;
  }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  p.sub { margin: 0 0 22px; color: var(--muted); font-size: 13px; }
  label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 10px 12px;
    margin-bottom: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    width: 100%;
    padding: 11px 12px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { filter: brightness(1.07); }
  .error {
    margin: 0 0 18px;
    padding: 10px 12px;
    border: 1px solid var(--error-border);
    border-radius: 8px;
    background: var(--error-bg);
    color: var(--error-text);
    font-size: 13px;
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">Sign in to continue.</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="${escapeHtml(loginPath)}" autocomplete="on">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" value="${escapeHtml(username)}"
           autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password"
           autocomplete="current-password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>
`;
}

export function renderMessagePage({ title, heading, message, refreshSeconds }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshSeconds ? `<meta http-equiv="refresh" content="${Number(refreshSeconds)}">` : ""}
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    padding: 24px; text-align: center;
    font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f6f6f7; color: #18181b;
  }
  @media (prefers-color-scheme: dark) { body { background: #0e0e11; color: #f2f2f4; } }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0; opacity: 0.72; font-size: 14px; }
</style>
</head>
<body><div><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p></div></body>
</html>
`;
}
