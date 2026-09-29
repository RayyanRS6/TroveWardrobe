import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";

const DEFAULT_STORAGE_LIMIT_BYTES = 9_000_000_000;

type B2Config = {
  bucketName: string;
  endpoint: URL;
  region: string;
};

export type StoredObject = {
  key: string;
  version: string;
};

/**
 * `status` is what the API answers: 503 when Backblaze settings are missing
 * or malformed, 502 when Backblaze itself refused or failed (the message
 * holds the upstream status for the logs).
 */
export class B2StorageError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
  ) {
    super(message);
  }
}

function requiredValue(value: string | undefined, name: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.startsWith("replace-with-")) {
    throw new B2StorageError(`${name} is not configured.`, 503);
  }
  return trimmed;
}

function config(): B2Config {
  const rawEndpoint = requiredValue(env.B2_ENDPOINT, "B2_ENDPOINT");
  let endpoint: URL;
  try {
    endpoint = new URL(
      rawEndpoint.startsWith("https://") ? rawEndpoint : `https://${rawEndpoint}`,
    );
  } catch {
    throw new B2StorageError("B2_ENDPOINT is not a valid URL.", 503);
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.hostname.endsWith(".backblazeb2.com")
  ) {
    throw new B2StorageError("B2_ENDPOINT must be a Backblaze HTTPS S3 endpoint.", 503);
  }

  const regionMatch = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i.exec(
    endpoint.hostname,
  );
  if (!regionMatch) {
    throw new B2StorageError("B2_ENDPOINT does not contain a valid B2 region.", 503);
  }

  return {
    bucketName: requiredValue(env.B2_BUCKET_NAME, "B2_BUCKET_NAME"),
    endpoint,
    region: regionMatch[1],
  };
}

function objectUrl(settings: B2Config, key: string) {
  const url = new URL(settings.endpoint);
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  url.pathname = `/${encodeURIComponent(settings.bucketName)}/${encodedKey}`;
  return url;
}

function client(settings: B2Config) {
  return new AwsClient({
    accessKeyId: requiredValue(env.B2_APPLICATION_KEY_ID, "B2_APPLICATION_KEY_ID"),
    secretAccessKey: requiredValue(env.B2_APPLICATION_KEY, "B2_APPLICATION_KEY"),
    service: "s3",
    region: settings.region,
    retries: 2,
  });
}

async function requireSuccess(response: Response, operation: string) {
  if (response.ok) return response;
  // Drain the XML error body; it can echo request details.
  await response.body?.cancel();
  throw new B2StorageError(
    `Backblaze B2 ${operation} failed with status ${response.status}.`,
    502,
  );
}

/**
 * Throws a 503 B2StorageError unless every Backblaze setting is present and
 * well formed. Uploads call this before spending image transformations.
 */
export function assertB2Configured() {
  const settings = config();
  client(settings);
}

/** The storage safety limit. Never above the default, even if configured higher. */
export function getB2StorageLimitBytes() {
  const parsedLimit = Number(env.B2_STORAGE_LIMIT_BYTES);
  return Number.isSafeInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, DEFAULT_STORAGE_LIMIT_BYTES)
    : DEFAULT_STORAGE_LIMIT_BYTES;
}

export async function putB2Object(
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
) {
  const settings = config();
  const response = await client(settings).fetch(objectUrl(settings, key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-server-side-encryption": "AES256",
    },
    body: bytes,
  });
  await requireSuccess(response, "upload");
  const versionId = response.headers.get("x-amz-version-id");
  if (!versionId) {
    throw new B2StorageError("Backblaze B2 did not return an object version ID.", 502);
  }
  return versionId;
}

export async function getB2Object(key: string, versionId: string) {
  const settings = config();
  const url = objectUrl(settings, key);
  if (versionId) url.searchParams.set("versionId", versionId);
  const response = await client(settings).fetch(url, {
    method: "GET",
  });

  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  return requireSuccess(response, "download");
}

export async function deleteB2Object(key: string, versionId: string) {
  const settings = config();
  const url = objectUrl(settings, key);
  if (versionId) url.searchParams.set("versionId", versionId);
  const response = await client(settings).fetch(url, {
    method: "DELETE",
  });

  if (response.status === 404) return;
  await requireSuccess(response, "delete");
}

/**
 * Deletes exact object versions without throwing. Failures are logged (key
 * and reason only) and leave an orphaned object in the private bucket.
 */
export async function deleteB2ObjectsQuietly(objects: StoredObject[], reason: string) {
  await Promise.all(
    objects
      .filter((object) => object.key)
      .map(async (object) => {
        try {
          await deleteB2Object(object.key, object.version);
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "B2 object delete failed",
              reason,
              key: object.key,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }),
  );
}
