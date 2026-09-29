// The standalone sign-in page served at GET /login: plain HTML with one
// nonce'd <style> and <script>, no app bundle and no external requests. Its
// fonts are the app's own (DM Sans, DM Serif Display) from public/fonts.

export type LoginNotice =
  | { kind: "none" }
  | { kind: "wrong-password" }
  | { kind: "locked"; seconds: number }
  | { kind: "unavailable" };

export function loginPageCsp(nonce: string) {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "font-src 'self'",
    "img-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** Reads ?error=1, ?error=unavailable and ?locked=<seconds>. */
export function loginNoticeFrom(params: URLSearchParams): LoginNotice {
  const locked = params.get("locked");
  if (locked !== null && /^[0-9]{1,6}$/.test(locked)) {
    return { kind: "locked", seconds: Math.min(Math.max(Number(locked), 1), 86_400) };
  }
  const error = params.get("error");
  if (error === "unavailable") return { kind: "unavailable" };
  if (error !== null) return { kind: "wrong-password" };
  return { kind: "none" };
}

function lockedMessage(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  const wait =
    minutes >= 120
      ? `about ${Math.round(minutes / 60)} hours`
      : minutes === 1
        ? "a minute"
        : `${minutes} minutes`;
  return `Too many attempts. Please wait ${wait}, then try again.`;
}

function noticeText(notice: LoginNotice) {
  switch (notice.kind) {
    case "wrong-password":
      return "That password didn't work. Please try again.";
    case "locked":
      return lockedMessage(notice.seconds);
    case "unavailable":
      return "Sign-in isn't available right now. Please try again later.";
    default:
      return "";
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLES = `
@font-face {
  font-family: "DM Sans";
  font-style: normal;
  font-weight: 100 1000;
  font-display: swap;
  src: url(/fonts/dm-sans-latin.woff2) format("woff2");
}
@font-face {
  font-family: "DM Serif Display";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(/fonts/dm-serif-display-latin.woff2) format("woff2");
}
/* The app's plum + blush palette. Contrast (WCAG 2.2 AA) in both themes:
   text and error >= 4.5:1, field border and focus ring >= 3:1 against page
   and field. The button is whichever of plum and blush stands out more from
   the page: plum on the light page, blush on the plum one. */
:root {
  --plum: #1F0818;
  --plum-high: #3A1832;
  --blush: #F4B6CE;
  --rose: #F08CAF;
  --ivory: #F8EEF1;
  --bg: #F8F1F2;
  --fg: var(--plum);
  --muted: #6B5563;
  --line: #8E7585;
  --focus: var(--plum);
  --field: #FFFAFB;
  --error: #B3264F;
  --button-bg: var(--plum);
  --button-fg: var(--ivory);
  --button-hover: var(--plum-high);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: var(--plum);
    --fg: var(--ivory);
    --muted: #BFA2B2;
    --line: #8A6C7E;
    --focus: var(--blush);
    --field: #2B1024;
    --error: #FF8A9A;
    --button-bg: var(--blush);
    --button-fg: var(--plum);
    --button-hover: #F8C9DB;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  font-synthesis-weight: none;
}
main { width: 100%; max-width: 360px; }
h1 {
  margin: 0 0 4px;
  font: 400 clamp(3rem, 14vw, 4rem)/1 "DM Serif Display", Georgia, "Times New Roman", serif;
  letter-spacing: -0.02em;
}
h1 span { color: var(--rose); }
::selection { background: var(--blush); color: var(--plum); }
.lede { margin: 0 0 32px; color: var(--muted); }
label { display: block; margin-bottom: 8px; font-weight: 600; }
input[type="password"] {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--field);
  color: var(--fg);
  caret-color: var(--fg);
  font: inherit;
}
/* Keep the field on-theme when a password manager fills it. */
input[type="password"]:-webkit-autofill {
  -webkit-text-fill-color: var(--fg);
  box-shadow: 0 0 0 100px var(--field) inset;
}
input[type="password"]:focus-visible, button:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.username {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  padding: 0;
  margin: -1px;
}
.notice { min-height: 1.5em; margin: 12px 0 20px; color: var(--error); font-size: 0.95rem; }
button {
  width: 100%;
  height: 52px;
  border: 0;
  border-radius: 999px;
  background: var(--button-bg);
  color: var(--button-fg);
  font: 700 1rem/1 "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
button:hover:not(:disabled) { background: var(--button-hover); }
button:disabled { opacity: 0.7; cursor: progress; }
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
`;

// Wipes offline data left by an earlier session on this device: service
// workers, Cache Storage and the wardrobe IndexedDB cache.
const SCRIPT = `
(function () {
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) { registration.unregister(); });
      }).catch(function () {});
    }
    if ("caches" in window) {
      caches.keys().then(function (keys) {
        keys.forEach(function (key) { caches.delete(key); });
      }).catch(function () {});
    }
    if ("indexedDB" in window) indexedDB.deleteDatabase("trove-cache");
  } catch (error) {}
  var form = document.getElementById("login");
  if (form) {
    form.addEventListener("submit", function () {
      var button = form.querySelector("button");
      if (button) {
        button.disabled = true;
        button.textContent = "Unlocking\\u2026";
      }
    });
  }
})();
`;

// The username input exists only so password managers can file the password.
// It stays rendered but clipped, since some managers skip display:none
// fields; aria-hidden and tabindex="-1" keep it out of the accessibility tree
// (Chromium reports it ignored, "ariaHiddenSubtree") and the tab order.
export function renderLoginPage(nonce: string, notice: LoginNotice) {
  const message = escapeHtml(noticeText(notice));
  const safeNonce = escapeHtml(nonce);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F8F1F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1F0818" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<title>Sign in · Trove</title>
<style nonce="${safeNonce}">${STYLES}</style>
</head>
<body>
<main>
  <h1>trove<span>.</span></h1>
  <p class="lede">Your wardrobe, remembered.</p>
  <form id="login" method="post" action="/api/auth/login">
    <input class="username" type="text" name="username" value="trove" autocomplete="username" tabindex="-1" aria-hidden="true" readonly>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024" autofocus aria-describedby="notice">
    <p id="notice" class="notice" role="alert">${message}</p>
    <button type="submit">Unlock</button>
  </form>
</main>
<script nonce="${safeNonce}">${SCRIPT}</script>
</body>
</html>
`;
}
