import { env } from "cloudflare:workers";
import {
  readAuthSecrets,
  readSessionToken,
  toBase64Url,
  verifySessionToken,
} from "../lib/auth";
import { loginNoticeFrom, loginPageCsp, renderLoginPage } from "../lib/login-page";

export const dynamic = "force-dynamic";

/**
 * GET /login: the only page served without a session. A small standalone
 * document (no app bundle) with its own strict, nonce-based CSP. Visitors
 * who are already signed in go straight to the wardrobe.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const auth = readAuthSecrets(env);
  if (auth.secrets) {
    const token = readSessionToken(
      request.headers.get("cookie"),
      url.protocol === "https:",
    );
    if (token && (await verifySessionToken(token, auth.secrets))) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/", "Cache-Control": "no-store" },
      });
    }
  }

  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  return new Response(renderLoginPage(nonce, loginNoticeFrom(url.searchParams)), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": loginPageCsp(nonce),
      "X-Robots-Tag": "noindex",
    },
  });
}
