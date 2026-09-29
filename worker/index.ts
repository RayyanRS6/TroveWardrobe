/// <reference types="vite/client" />
/**
 * Cloudflare Worker entry point for Trove: a password gate in front of the
 * vinext app. Deny by default; built static files (dist/client) are served
 * by Workers Assets before this code runs and hold no wardrobe data.
 */
import handler from "vinext/server/app-router-entry";
import {
  clearedSessionCookies,
  createSessionToken,
  hasSessionCookie,
  isMutatingMethod,
  isSameOriginRequest,
  nowSeconds,
  readAuthSecrets,
  readSessionToken,
  sessionCookie,
  sessionNeedsRenewal,
  toBase64Url,
  verifySessionToken,
} from "../app/lib/auth";
import { discardRequestBody, MULTIPART_MAX_BYTES } from "../app/lib/wardrobe-input";

// Client-supplied headers the app must never trust: the old Cloudflare
// Access identity, and CSP headers (vinext reads the script nonce from the
// inbound request, so only this Worker may set one).
const UNTRUSTED_REQUEST_HEADERS = [
  "cf-access-authenticated-user-email",
  "cf-access-jwt-assertion",
  "content-security-policy",
  "content-security-policy-report-only",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The only routes that work without a session. */
function isPublicRoute(method: string, pathname: string) {
  return (
    ((method === "GET" || method === "HEAD") && pathname === "/login") ||
    (method === "POST" && pathname === "/api/auth/login")
  );
}

function isNavigation(request: Request) {
  return (
    request.headers.get("sec-fetch-mode") === "navigate" ||
    (request.headers.get("accept") ?? "").includes("text/html")
  );
}

/** CSP for app pages. vinext adds the nonce to every inline and entry script. */
function appCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function jsonError(status: number, error: string, code: string) {
  return Response.json(
    { error, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function withSecurityHeaders(response: Response, url: URL, nonce: string | null) {
  const secured = new Response(response.body, response);
  const headers = secured.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  // Not no-referrer: under it Safari and Firefox send "Origin: null" on the
  // login form post. same-origin still sends nothing to other sites.
  headers.set("Referrer-Policy", "same-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  if (url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // Pages that bring their own policy (the login page) keep it.
  if (
    nonce &&
    !headers.has("Content-Security-Policy") &&
    (headers.get("Content-Type") ?? "").startsWith("text/html")
  ) {
    headers.set("Content-Security-Policy", appCsp(nonce));
  }
  return secured;
}

type SessionCheck = { valid: false } | { valid: true; renewCookie: string | null };

/**
 * Verifies the session cookie. Missing or malformed secrets fail closed:
 * nobody gets in, and the log names the problem (never a value).
 */
async function checkSession(request: Request, env: Env, url: URL): Promise<SessionCheck> {
  const auth = readAuthSecrets(env);
  if (!auth.secrets) {
    console.error(
      JSON.stringify({
        message: "Sign-in is misconfigured; refusing all requests",
        problems: auth.problems,
      }),
    );
    return { valid: false };
  }

  const secure = url.protocol === "https:";
  const token = readSessionToken(request.headers.get("cookie"), secure);
  const now = nowSeconds();
  const session = token ? await verifySessionToken(token, auth.secrets, now) : null;
  if (!session) return { valid: false };
  if (!sessionNeedsRenewal(session, now)) return { valid: true, renewCookie: null };

  // Sliding renewal keeps the original login time, so the 90-day cap holds.
  const renewed = await createSessionToken(auth.secrets, now, session.auth);
  return {
    valid: true,
    renewCookie: sessionCookie(renewed.token, renewed.payload, secure, now),
  };
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Session cookies are Secure: production is https only. Plain http is
    // for local development on this computer.
    if (!import.meta.env.DEV && url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
      url.protocol = "https:";
      return withSecurityHeaders(Response.redirect(url.toString(), 308), url, null);
    }

    if (isMutatingMethod(method) && !isSameOriginRequest(request)) {
      await discardRequestBody(request);
      return withSecurityHeaders(
        jsonError(403, "This request was blocked because it came from another site.", "cross_origin"),
        url,
        null,
      );
    }

    let renewCookie: string | null = null;
    if (!isPublicRoute(method, url.pathname)) {
      const session = await checkSession(request, env, url);
      if (!session.valid) {
        await discardRequestBody(request);
        const denied = isNavigation(request)
          ? new Response(null, {
              status: 303,
              headers: { Location: "/login", "Cache-Control": "no-store" },
            })
          : jsonError(401, "Please sign in again.", "unauthenticated");
        if (hasSessionCookie(request.headers.get("cookie"))) {
          for (const cookie of clearedSessionCookies()) denied.headers.append("Set-Cookie", cookie);
        }
        return withSecurityHeaders(denied, url, null);
      }
      renewCookie = session.renewCookie;
    }

    // vinext screens large writes as possible Server Actions and answers a
    // plain-text 413; anything over the biggest API body gets a JSON one here.
    const declaredLength = Number(request.headers.get("content-length"));
    if (isMutatingMethod(method) && declaredLength > MULTIPART_MAX_BYTES) {
      await discardRequestBody(request);
      return withSecurityHeaders(
        jsonError(413, "Please use a photo smaller than 10 MB.", "too_large"),
        url,
        null,
      );
    }

    const headers = new Headers(request.headers);
    for (const name of UNTRUSTED_REQUEST_HEADERS) headers.delete(name);

    // Production pages get a per-request script nonce (Vite's dev HMR
    // scripts carry none, so dev runs without a CSP).
    let nonce: string | null = null;
    if (!import.meta.env.DEV && (method === "GET" || method === "HEAD") && !url.pathname.startsWith("/api/")) {
      nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
      headers.set("content-security-policy", appCsp(nonce));
    }

    const response = await handler.fetch(new Request(request, { headers }), env, ctx);
    const secured = withSecurityHeaders(response, url, nonce);
    if (
      renewCookie &&
      url.pathname !== "/api/auth/logout" &&
      !secured.headers.has("Set-Cookie")
    ) {
      secured.headers.append("Set-Cookie", renewCookie);
    }
    return secured;
  },
} satisfies ExportedHandler<Env>;

export default worker;
