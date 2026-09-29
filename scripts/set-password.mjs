// Manages the Trove app password. Only a PBKDF2 hash of it is ever stored.
//
//   npm run set-password                    change the local dev password (.env)
//   npm run set-password -- --generate      random local dev password, noted in .env
//   npm run set-password -- --production    set the live password: asks for it, then
//                                           uploads its hash, a new session secret and
//                                           the Backblaze values from .env as Worker
//                                           secrets. Nothing is written to disk.
//
// Changing a password signs out every device that used the old one.
import { spawn } from "node:child_process";
import { pbkdf2Sync, randomBytes, randomInt } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_FILE = ".env";
const EXAMPLE_FILE = ".env.example";
// Workers Free allows 10 ms of CPU per request; 20,000 rounds take ~5 ms.
// Login throttling and the write-only secret store carry the rest.
const ITERATIONS = 20_000;
const MIN_LENGTH = 12;
const DEV_NOTE = "# Local dev password";
const B2_KEYS = [
  "B2_ENDPOINT",
  "B2_BUCKET_NAME",
  "B2_APPLICATION_KEY_ID",
  "B2_APPLICATION_KEY",
];
// No look-alike characters (0/o, 1/l/i) so the password is easy to type.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const WRANGLER = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

const args = new Set(process.argv.slice(2));

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password.normalize("NFC"), salt, ITERATIONS, 32, "sha256");
  // Colon-separated: `$` would be expanded by dotenv when the file is loaded.
  return [
    "pbkdf2-sha256",
    ITERATIONS,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
}

function newSessionSecret() {
  return randomBytes(32).toString("base64url");
}

function generatePassword() {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  );
  return groups.join("-");
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error("Run this in a terminal so the password can be typed privately."));
      return;
    }
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function askNewPassword(label) {
  const password = await promptHidden(`New ${label} password (${MIN_LENGTH}+ characters): `);
  if (password.length < MIN_LENGTH) {
    throw new Error(`Use at least ${MIN_LENGTH} characters. Nothing was changed.`);
  }
  if ((await promptHidden("Repeat it: ")) !== password) {
    throw new Error("The passwords did not match. Nothing was changed.");
  }
  return password;
}

function readEnvFile() {
  if (!existsSync(ENV_FILE)) {
    copyFileSync(EXAMPLE_FILE, ENV_FILE);
    console.log(`Created ${ENV_FILE} from ${EXAMPLE_FILE}.`);
  }
  return readFileSync(ENV_FILE, "utf8");
}

function envValue(text, key) {
  return new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1].trim() ?? "";
}

function setLine(text, pattern, line) {
  return pattern.test(text)
    ? text.replace(pattern, () => line)
    : `${text.replace(/\s*$/, "\n")}${line}\n`;
}

function setEnvValue(text, key, value) {
  return setLine(text, new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
}

function removeDevNote(text) {
  return text
    .replace(/^# (Local dev password|Generated app password).*(\r?\n)?/gm, "")
    .replace(/(\r?\n){3,}/g, "\n\n");
}

async function setLocalPassword() {
  let env = readEnvFile();
  const generate = args.has("--generate");
  const password = generate ? generatePassword() : await askNewPassword("local dev");

  env = removeDevNote(env);
  env = setEnvValue(env, "APP_PASSWORD_HASH", hashPassword(password));
  env = setEnvValue(env, "SESSION_SECRET", newSessionSecret());
  if (generate) {
    // Dev-only convenience: this password unlocks only the local dev server.
    env = setLine(
      env,
      /^APP_PASSWORD_HASH=.*$/m,
      `${DEV_NOTE} (unlocks only the dev server on this computer): ${password}\n` +
        `APP_PASSWORD_HASH=${envValue(env, "APP_PASSWORD_HASH")}`,
    );
  }
  writeFileSync(ENV_FILE, env);
  console.log(
    generate
      ? `Saved a random local dev password in ${ENV_FILE} (the "${DEV_NOTE}" line).`
      : `Saved the new local dev password hash in ${ENV_FILE}.`,
  );
  console.log("Restart `npm run dev` to use it. Local sessions were signed out.");
}

async function setProductionPassword() {
  const env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const secrets = {};
  const missing = B2_KEYS.filter((key) => !envValue(env, key));
  if (missing.length === 0) {
    for (const key of B2_KEYS) secrets[key] = envValue(env, key);
  } else {
    console.log(
      `Skipping Backblaze secrets (missing in ${ENV_FILE}: ${missing.join(", ")}).`,
    );
  }

  console.log("This sets the password for the live app. It is never saved to a file.");
  const password = await askNewPassword("app");
  secrets.APP_PASSWORD_HASH = hashPassword(password);
  secrets.SESSION_SECRET = newSessionSecret();

  console.log(`Uploading ${Object.keys(secrets).length} secrets to Cloudflare...`);
  const child = spawn(process.execPath, [WRANGLER, "secret", "bulk"], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin.end(JSON.stringify(secrets));
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) {
    throw new Error("Wrangler could not upload the secrets. Nothing was changed.");
  }
  console.log("Done. Every signed-in device must log in again with the new password.");
}

(args.has("--production") ? setProductionPassword() : setLocalPassword()).catch(
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
