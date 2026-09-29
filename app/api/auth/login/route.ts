import { env } from "cloudflare:workers";
import {
  clientBucket,
  createSessionToken,
  isSameOriginRequest,
  nowSeconds,
  readAuthSecrets,
  sessionCookie,
  verifyPassword,
} from "../../../lib/auth";
import { clearLoginAttempts, reserveLoginAttempt } from "../../../lib/login-throttle";
import {
  discardRequestBody,
  mediaType,
  readBodyWithLimit,
} from "../../../lib/wardrobe-input";
import { apiError, getWardrobeDb, jsonError } from "../../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;

function seeOther(location: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/**
 * The login form posts here (application/x-www-form-urlencoded, field
 * `password`). Every outcome is a 303: back to /login with ?error=1 or
 * ?locked=<seconds>, or on to / with a session cookie.
 *
 * Never log the request body.
 */
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      await discardRequestBody(request);
      return jsonError(403, "Sign-in must come from this site.", "cross_origin");
    }
    if (mediaType(request) !== "application/x-www-form-urlencoded") {
      await discardRequestBody(request);
      return jsonError(
        415,
        "Send the sign-in form as application/x-www-form-urlencoded.",
        "unsupported_media_type",
      );
    }
    const body = await readBodyWithLimit(
      request,
      MAX_BODY_BYTES,
      "That sign-in request is too large.",
    );

    const auth = readAuthSecrets(env);
    if (!auth.secrets) {
      console.error(
        JSON.stringify({ message: "Sign-in is misconfigured", problems: auth.problems }),
      );
      return seeOther("/login?error=unavailable");
    }

    // Throttle before hashing: a locked client costs no PBKDF2 work.
    const db = getWardrobeDb();
    const bucket = clientBucket(request.headers.get("cf-connecting-ip"));
    const now = nowSeconds();
    const attempt = await reserveLoginAttempt(db, bucket, now);
    if (!attempt.allowed) return seeOther(`/login?locked=${attempt.retryAfter}`);

    const password = new URLSearchParams(new TextDecoder().decode(body)).get("password") ?? "";
    if (!(await verifyPassword(password, auth.secrets.passwordHash))) {
      return attempt.lockedUntil > now
        ? seeOther(`/login?locked=${attempt.lockedUntil - now}`)
        : seeOther("/login?error=1");
    }

    await clearLoginAttempts(db, bucket);
    const { token, payload } = await createSessionToken(auth.secrets, now);
    const response = seeOther("/");
    response.headers.append(
      "Set-Cookie",
      sessionCookie(token, payload, new URL(request.url).protocol === "https:", now),
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}
