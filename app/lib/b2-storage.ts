import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";

const DEFAULT_STORAGE_LIMIT_BYTES = 9_000_000_000;

type B2Config = {
  bucketName: string;
  endpoint: URL;
  region: string;
  storageLimitBytes: number;
};

export class B2StorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function requiredValue(value: string, name: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("replace-with-")) {
    throw new B2StorageError(`${name} is not configured.`, 503);
  }
  return trimmed;
}

function applicationKey() {
  const value = env.B2_APPLICATION_KEY;
  if (typeof value !== "string" || !value.trim()) {
    throw new B2StorageError("B2_APPLICATION_KEY is not configured.", 503);
  }
  return value.trim();
}

function config(): B2Config {
  const rawEndpoint = requiredValue(env.B2_ENDPOINT, "B2_ENDPOINT");
  const endpoint = new URL(
    rawEndpoint.startsWith("https://") ? rawEndpoint : `https://${rawEndpoint}`,
  );

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

  const parsedLimit = Number(env.B2_STORAGE_LIMIT_BYTES);
  const storageLimitBytes =
    Number.isSafeInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, DEFAULT_STORAGE_LIMIT_BYTES)
      : DEFAULT_STORAGE_LIMIT_BYTES;

  return {
    bucketName: requiredValue(env.B2_BUCKET_NAME, "B2_BUCKET_NAME"),
    endpoint,
    region: regionMatch[1],
    storageLimitBytes,
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
    accessKeyId: requiredValue(
      env.B2_APPLICATION_KEY_ID,
      "B2_APPLICATION_KEY_ID",
    ),
    secretAccessKey: applicationKey(),
    service: "s3",
    region: settings.region,
    retries: 2,
  });
}

async function requireSuccess(response: Response, operation: string) {
  if (response.ok) return response;
  throw new B2StorageError(
    `Backblaze B2 ${operation} failed with status ${response.status}.`,
    response.status,
  );
}

export function getB2StorageLimitBytes() {
  return config().storageLimitBytes;
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
      "Cache-Control": "private, max-age=31536000, immutable",
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

  if (response.status === 404) return null;
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
