import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import test from "node:test";
import {
  AuthConfigError,
  clearedSessionCookies,
  clientBucket,
  createSessionToken,
  isSameOriginRequest,
  readAuthSecrets,
  readSessionToken,
  sessionCookie,
  sessionNeedsRenewal,
  verifyPassword,
  verifySessionToken,
} from "../app/lib/auth.ts";

const DAY = 24 * 60 * 60;
const PASSWORD = "correct horse battery staple";

// Same format and normalization as scripts/set-password.mjs.
function hashPassword(password, iterations = 20_000) {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password.normalize("NFC"), salt, iterations, 32, "sha256");
  return ["pbkdf2-sha256", iterations, salt.toString("base64url"), key.toString("base64url")].join(":");
}

const passwordHash = hashPassword(PASSWORD);
const secrets = { passwordHash, sessionSecret: randomBytes(32).toString("base64url") };
const NOW = 1_790_000_000;

test("verifyPassword accepts the right password and rejects wrong ones", async () => {
  assert.equal(await verifyPassword(PASSWORD, passwordHash), true);
  assert.equal(await verifyPassword(`${PASSWORD} `, passwordHash), false);
  assert.equal(await verifyPassword("Correct horse battery staple", passwordHash), false);
  assert.equal(await verifyPassword("", passwordHash), false);
  assert.equal(await verifyPassword("x".repeat(1025), passwordHash), false);
});

test("verifyPassword normalizes to NFC like set-password", async () => {
  const hash = hashPassword("café crème");
  assert.equal(await verifyPassword("café crème".normalize("NFD"), hash), true);
  assert.equal(await verifyPassword("cafe creme", hash), false);
});

test("a malformed password hash fails closed", async () => {
  const [, iterations, salt, key] = passwordHash.split(":");
  const malformed = [
    "",
    "not-a-hash",
    `pbkdf2-sha512:${iterations}:${salt}:${key}`,
    `pbkdf2-sha256$${iterations}$${salt}$${key}`,
    `pbkdf2-sha256:${iterations}:${salt}`,
    `pbkdf2-sha256:abc:${salt}:${key}`,
    `pbkdf2-sha256:1000:${salt}:${key}`,
    `pbkdf2-sha256:500000:${salt}:${key}`,
    `pbkdf2-sha256:${iterations}:${salt}:${key.slice(0, -2)}`,
    `pbkdf2-sha256:${iterations}:!!!:${key}`,
  ];
  for (const hash of malformed) {
    await assert.rejects(verifyPassword(PASSWORD, hash), AuthConfigError, hash);
  }
});

test("readAuthSecrets reports missing or malformed secrets by name only", () => {
  assert.deepEqual(readAuthSecrets({ APP_PASSWORD_HASH: passwordHash, SESSION_SECRET: secrets.sessionSecret }), {
    secrets: { passwordHash, sessionSecret: secrets.sessionSecret },
  });

  const missing = readAuthSecrets({});
  assert.equal(missing.secrets, undefined);
  assert.deepEqual(missing.problems, ["APP_PASSWORD_HASH is missing", "SESSION_SECRET is missing"]);

  const weak = readAuthSecrets({ APP_PASSWORD_HASH: "abc", SESSION_SECRET: "short-secret" });
  assert.equal(weak.problems.length, 2);
  assert.ok(weak.problems.every((problem) => !problem.includes("abc") && !problem.includes("short-secret")));
});

test("session tokens round-trip in the v1 format", async () => {
  const { token, payload } = await createSessionToken(secrets, NOW);
  assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.ok(token.length <= 512);
  assert.deepEqual(Object.keys(payload).sort(), ["auth", "exp", "iat", "pwv"]);
  assert.equal(payload.iat, NOW);
  assert.equal(payload.auth, NOW);
  assert.equal(payload.exp, NOW + 30 * DAY);
  assert.equal(payload.pwv.length, 16);
  assert.deepEqual(await verifySessionToken(token, secrets, NOW + 60), payload);

  // HMAC-SHA256 over "v1.<payload>" with SESSION_SECRET.
  const [, body, signature] = token.split(".");
  const expected = createHmac("sha256", secrets.sessionSecret).update(`v1.${body}`).digest("base64url");
  assert.equal(signature, expected);
});

test("tampered, foreign or malformed tokens are rejected", async () => {
  const { token } = await createSessionToken(secrets, NOW);
  const [version, body, signature] = token.split(".");
  const forgedBody = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), exp: NOW + 999 * DAY }),
  ).toString("base64url");
  const flip = (value) => (value[0] === "A" ? "B" : "A") + value.slice(1);

  const rejected = [
    `${version}.${forgedBody}.${signature}`,
    `${version}.${body}.${flip(signature)}`,
    `${version}.${flip(body)}.${signature}`,
    `v2.${body}.${signature}`,
    `${version}.${body}`,
    `${token}.extra`,
    `${version}.${body}.${signature}${"A".repeat(520)}`,
    "",
    "garbage",
  ];
  for (const candidate of rejected) {
    assert.equal(await verifySessionToken(candidate, secrets, NOW), null, candidate.slice(0, 40));
  }

  const otherSecret = { ...secrets, sessionSecret: randomBytes(32).toString("base64url") };
  assert.equal(await verifySessionToken(token, otherSecret, NOW), null);
});

test("tokens expire, and future-dated tokens are rejected", async () => {
  const { token } = await createSessionToken(secrets, NOW);
  assert.ok(await verifySessionToken(token, secrets, NOW + 30 * DAY - 1));
  assert.equal(await verifySessionToken(token, secrets, NOW + 30 * DAY), null);

  const skewed = await createSessionToken(secrets, NOW + 30);
  assert.ok(await verifySessionToken(skewed.token, secrets, NOW), "30 s of clock skew is tolerated");
  const future = await createSessionToken(secrets, NOW + 120);
  assert.equal(await verifySessionToken(future.token, secrets, NOW), null);
});

test("renewal keeps the login time and never passes 90 days", async () => {
  const first = await createSessionToken(secrets, NOW);
  assert.equal(sessionNeedsRenewal(first.payload, NOW + DAY), false);
  assert.equal(sessionNeedsRenewal(first.payload, NOW + DAY + 1), true);

  const renewed = await createSessionToken(secrets, NOW + 80 * DAY, first.payload.auth);
  assert.equal(renewed.payload.auth, NOW);
  assert.equal(renewed.payload.exp, NOW + 90 * DAY);
  assert.ok(await verifySessionToken(renewed.token, secrets, NOW + 89 * DAY));
  assert.equal(await verifySessionToken(renewed.token, secrets, NOW + 90 * DAY), null);
});

test("changing the password signs every session out", async () => {
  const { token } = await createSessionToken(secrets, NOW);
  const rotated = { ...secrets, passwordHash: hashPassword(PASSWORD) };
  assert.equal(await verifySessionToken(token, rotated, NOW), null);
});

test("session cookies use __Host- with Secure on https and a plain name on http", async () => {
  const { token, payload } = await createSessionToken(secrets, NOW);
  const secure = sessionCookie(token, payload, true, NOW);
  assert.equal(
    secure,
    `__Host-trove_session=${token}; Max-Age=${30 * DAY}; Path=/; HttpOnly; SameSite=Lax; Secure`,
  );
  const local = sessionCookie(token, payload, false, NOW);
  assert.equal(local, `trove_session=${token}; Max-Age=${30 * DAY}; Path=/; HttpOnly; SameSite=Lax`);

  const header = `theme=dark; trove_session=local-token; __Host-trove_session=${token}`;
  assert.equal(readSessionToken(header, true), token);
  assert.equal(readSessionToken(header, false), "local-token");
  assert.equal(readSessionToken("theme=dark", true), null);
  assert.equal(readSessionToken(null, true), null);

  const cleared = clearedSessionCookies();
  assert.equal(cleared.length, 2);
  assert.ok(cleared[0].startsWith("__Host-trove_session=;") && cleared[0].includes("Secure"));
  assert.ok(cleared[1].startsWith("trove_session=;"));
  assert.ok(cleared.every((cookie) => cookie.includes("Max-Age=0") && cookie.includes("Path=/")));
});

test("same-origin checks use Sec-Fetch-Site and Origin", () => {
  const post = (headers) =>
    new Request("https://trove.example/api/items", { method: "POST", headers });
  assert.equal(isSameOriginRequest(post({})), true);
  assert.equal(isSameOriginRequest(post({ "Sec-Fetch-Site": "same-origin" })), true);
  assert.equal(isSameOriginRequest(post({ Origin: "https://trove.example" })), true);
  assert.equal(isSameOriginRequest(post({ "Sec-Fetch-Site": "cross-site" })), false);
  assert.equal(isSameOriginRequest(post({ "Sec-Fetch-Site": "same-site" })), false);
  assert.equal(isSameOriginRequest(post({ Origin: "https://evil.example" })), false);
  assert.equal(isSameOriginRequest(post({ Origin: "null" })), false);
  assert.equal(
    isSameOriginRequest(post({ "Sec-Fetch-Site": "same-origin", Origin: "http://trove.example" })),
    false,
  );
});

test("throttle buckets group IPv6 clients by /64", () => {
  assert.equal(clientBucket("203.0.113.7"), "ip:203.0.113.7");
  assert.equal(clientBucket("2001:db8:1:2:3:4:5:6"), "ip:2001:db8:1:2::/64");
  assert.equal(clientBucket("2001:DB8:1:2::99"), "ip:2001:db8:1:2::/64");
  assert.equal(clientBucket("2001:db8::1"), "ip:2001:db8:0:0::/64");
  assert.equal(clientBucket("::ffff:192.0.2.1"), "ip:192.0.2.1");
  assert.equal(clientBucket(null), "ip:local");
  assert.equal(clientBucket(""), "ip:local");
});
