// App password and session cookies for Trove's single owner.
//
// Pure Web Crypto with only erasable TypeScript syntax: no `cloudflare:*` or
// `node:*` imports, so `node --test` can import this file directly.
//
// APP_PASSWORD_HASH  "pbkdf2-sha256:<iterations>:<salt b64url>:<32-byte key b64url>"
//                    written by scripts/set-password.mjs (NFC-normalized password).
// SESSION_SECRET     HMAC-SHA256 key for session tokens.
// Session token      "v1.<payload b64url>.<signature b64url>", payload
//                    {iat, exp, auth, pwv}: issued at, expires at, original
//                    login time (Unix seconds) and a fingerprint of the
//                    password hash, so changing the password signs out every
//                    device.

export const SESSION_COOKIE = "__Host-trove_session";
// Browsers drop `Secure` and `__Host-` cookies on plain http, so local dev
// (http://localhost) uses a plain name.
export const DEV_SESSION_COOKIE = "trove_session";

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
export const SESSION_ABSOLUTE_MAX_SECONDS = 90 * 24 * 60 * 60;
export const MAX_PASSWORD_LENGTH = 1024;

const TOKEN_VERSION = "v1";
const MAX_TOKEN_LENGTH = 512;
const CLOCK_SKEW_SECONDS = 60;
const KEY_BYTES = 32;
// Workers cap PBKDF2 at 100,000 iterations; set-password uses 20,000 so a
// login fits the 10 ms CPU budget of Workers Free.
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 100_000;
const MIN_SESSION_SECRET_LENGTH = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const encoder = new TextEncoder();

export type SessionPayload = {
  iat: number;
  exp: number;
  auth: number;
  pwv: string;
};

export type AuthSecrets = {
  passwordHash: string;
  sessionSecret: string;
};

type ParsedPasswordHash = {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  key: Uint8Array<ArrayBuffer>;
};

/** A missing or malformed secret. The message names the secret, never its value. */
export class AuthConfigError extends Error {}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Reads the two auth secrets. Anything missing or malformed returns the
 * secret names as `problems` so callers can fail closed and log safely.
 */
export function readAuthSecrets(env: {
  APP_PASSWORD_HASH?: unknown;
  SESSION_SECRET?: unknown;
}): { secrets: AuthSecrets; problems?: undefined } | { secrets?: undefined; problems: string[] } {
  const problems: string[] = [];
  const passwordHash =
    typeof env.APP_PASSWORD_HASH === "string" ? env.APP_PASSWORD_HASH.trim() : "";
  const sessionSecret =
    typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET.trim() : "";

  if (!parsePasswordHash(passwordHash)) {
    problems.push(
      passwordHash
        ? "APP_PASSWORD_HASH is malformed (expected pbkdf2-sha256:<iterations>:<salt>:<key>)"
        : "APP_PASSWORD_HASH is missing",
    );
  }
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(
      sessionSecret
        ? `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters`
        : "SESSION_SECRET is missing",
    );
  }
  return problems.length ? { problems } : { secrets: { passwordHash, sessionSecret } };
}

function parsePasswordHash(value: string): ParsedPasswordHash | null {
  const parts = value.trim().split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  if (!/^[1-9][0-9]{0,6}$/.test(parts[1])) return null;

  const iterations = Number(parts[1]);
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;

  const salt = fromBase64Url(parts[2]);
  const key = fromBase64Url(parts[3]);
  if (!salt || salt.length < 8 || salt.length > 64) return null;
  if (!key || key.length !== KEY_BYTES) return null;
  return { iterations, salt, key };
}

/**
 * Checks a password against APP_PASSWORD_HASH. Throws AuthConfigError when
 * the stored hash is malformed, so a broken secret never lets anyone in.
 */
export async function verifyPassword(password: string, passwordHash: string) {
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) throw new AuthConfigError("APP_PASSWORD_HASH is malformed.");
  if (typeof password !== "string" || !password || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }

  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: parsed.salt,
        iterations: parsed.iterations,
      },
      material,
      KEY_BYTES * 8,
    ),
  );
  return constantTimeEqual(derived, parsed.key);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== KEY_BYTES || b.length !== KEY_BYTES) return false;
  let difference = 0;
  for (let index = 0; index < KEY_BYTES; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

/** First 16 characters of base64url(SHA-256(APP_PASSWORD_HASH)). */
export async function passwordVersion(passwordHash: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(passwordHash.trim()));
  return toBase64Url(new Uint8Array(digest)).slice(0, 16);
}

let cachedHmac: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string) {
  if (cachedHmac?.secret !== secret) {
    cachedHmac = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
    };
  }
  return cachedHmac.key;
}

/**
 * Signs a new session. `auth` is the original login time and survives
 * renewals; no session outlives it by more than 90 days.
 */
export async function createSessionToken(
  secrets: AuthSecrets,
  now: number = nowSeconds(),
  auth: number = now,
) {
  const payload: SessionPayload = {
    iat: now,
    exp: Math.min(now + SESSION_MAX_AGE_SECONDS, auth + SESSION_ABSOLUTE_MAX_SECONDS),
    auth,
    pwv: await passwordVersion(secrets.passwordHash),
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secrets.sessionSecret),
    encoder.encode(`${TOKEN_VERSION}.${body}`),
  );
  return {
    token: `${TOKEN_VERSION}.${body}.${toBase64Url(new Uint8Array(signature))}`,
    payload,
  };
}

/** Returns the payload of a valid, current session token, otherwise null. */
export async function verifySessionToken(
  token: string,
  secrets: AuthSecrets,
  now: number = nowSeconds(),
): Promise<SessionPayload | null> {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, body, signatureText] = parts;
  if (!BASE64URL.test(body) || !BASE64URL.test(signatureText)) return null;

  const signature = fromBase64Url(signatureText);
  if (!signature || signature.length !== 32) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secrets.sessionSecret),
    signature,
    encoder.encode(`${TOKEN_VERSION}.${body}`),
  );
  if (!valid) return null;

  const payload = parsePayload(body);
  if (!payload) return null;
  if (payload.exp <= now) return null;
  if (payload.iat > now + CLOCK_SKEW_SECONDS) return null;
  if (payload.auth > payload.iat + CLOCK_SKEW_SECONDS) return null;
  if (now - payload.auth > SESSION_ABSOLUTE_MAX_SECONDS) return null;
  if (payload.pwv !== (await passwordVersion(secrets.passwordHash))) return null;
  return payload;
}

function parsePayload(body: string): SessionPayload | null {
  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof value !== "object" || value === null) return null;
    const { iat, exp, auth, pwv } = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(iat) ||
      !Number.isSafeInteger(exp) ||
      !Number.isSafeInteger(auth) ||
      typeof pwv !== "string"
    ) {
      return null;
    }
    return { iat: iat as number, exp: exp as number, auth: auth as number, pwv };
  } catch {
    return null;
  }
}

/** Sessions older than a day are re-issued (same login time) on the next request. */
export function sessionNeedsRenewal(payload: SessionPayload, now: number = nowSeconds()) {
  return now - payload.iat > SESSION_RENEW_AFTER_SECONDS;
}

export function sessionCookieName(secure: boolean) {
  return secure ? SESSION_COOKIE : DEV_SESSION_COOKIE;
}

export function sessionCookie(
  token: string,
  payload: SessionPayload,
  secure: boolean,
  now: number = nowSeconds(),
) {
  const maxAge = Math.max(0, Math.min(payload.exp - now, SESSION_MAX_AGE_SECONDS));
  return [
    `${sessionCookieName(secure)}=${token}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Set-Cookie values that remove both the https and the local dev cookie. */
export function clearedSessionCookies() {
  const expired = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; SameSite=Lax";
  return [`${SESSION_COOKIE}=; ${expired}; Secure`, `${DEV_SESSION_COOKIE}=; ${expired}`];
}

/** The session token from a Cookie header, using the name for this protocol. */
export function readSessionToken(cookieHeader: string | null, secure: boolean) {
  if (!cookieHeader) return null;
  const name = sessionCookieName(secure);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

/** True when the request carries a session cookie of either name. */
export function hasSessionCookie(cookieHeader: string | null) {
  return readSessionToken(cookieHeader, true) !== null || readSessionToken(cookieHeader, false) !== null;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingMethod(method: string) {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 * Same-origin check for state-changing requests: Sec-Fetch-Site must be
 * "same-origin" (or absent, for older browsers and non-browser clients) and a
 * present Origin header must equal the request's own origin.
 *
 * "Origin: null" passes only alongside Sec-Fetch-Site: same-origin, a header
 * pages cannot set. Safari and Firefox send null on a same-origin form post
 * from a page whose referrer policy is no-referrer; posts from opaque origins
 * (sandboxed frames, data: URLs) or through cross-site redirects are marked
 * cross-site and stay blocked.
 */
export function isSameOriginRequest(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (origin === "null") return site === "same-origin";
  return origin === new URL(request.url).origin;
}

/**
 * Login-throttle bucket for a client address: "ip:<IPv4>" or, because one
 * IPv6 user usually controls a whole /64, "ip:<first four groups>::/64".
 * Local dev has no CF-Connecting-IP header and uses "ip:local".
 */
export function clientBucket(connectingIp: string | null) {
  const value = connectingIp?.trim().toLowerCase().split("%")[0] ?? "";
  if (!value) return "ip:local";
  if (!value.includes(":")) return `ip:${value.slice(0, 45)}`;

  const groups = expandIpv6(value);
  if (!groups) return `ip:${value.slice(0, 45)}`;
  const mappedIpv4 =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mappedIpv4) {
    return `ip:${[groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".")}`;
  }
  return `ip:${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

function expandIpv6(value: string): number[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string) => {
    if (!half) return [];
    const groups: number[] = [];
    const parts = half.split(":");
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1 && part.includes(".")) {
        const octets = part.split(".").map(Number);
        if (
          octets.length !== 4 ||
          octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
        ) {
          return null;
        }
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        groups.push(parseInt(part, 16));
      } else {
        return null;
      }
    }
    return groups;
  };

  const head = parseHalf(halves[0]);
  const tail = halves.length === 2 ? parseHalf(halves[1]) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...head, ...Array<number>(Math.max(missing, 0)).fill(0), ...tail];
}

export function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!value || !BASE64URL.test(value) || value.length % 4 === 1) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
