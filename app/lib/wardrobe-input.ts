import {
  detectImageType,
  IMAGE_SIGNATURE_BYTES,
} from "./image-processing";
import {
  CATEGORY_MAX,
  COLOR_MAX,
  IMAGE_MAX_BYTES,
  NAME_MAX,
  OCCASIONS,
  RESERVED_CATEGORY,
  SEASONS,
} from "./wardrobe-options";

// Multipart overhead allowance on top of the photo itself.
export const MULTIPART_MAX_BYTES = IMAGE_MAX_BYTES + 64 * 1024;
export const JSON_MAX_BYTES = 16 * 1024;

const DEFAULT_CODES: Record<number, string> = {
  400: "invalid_input",
  404: "not_found",
  413: "too_large",
  415: "unsupported_media_type",
  507: "storage_full",
};

/** A client error with a message that is safe to show to the user. */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code ?? DEFAULT_CODES[status];
  }
}

export function mediaType(request: Request) {
  return (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/** A positive integer route id, or a 400 naming the kind of record. */
export function parseId(rawId: string, label: string) {
  if (!/^[1-9][0-9]{0,15}$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
    throw new RequestError(400, `That ${label} link is not valid.`);
  }
  return Number(rawId);
}

// A client only sees an early 413 reliably once its upload is consumed, so a
// modest overrun is read and thrown away; anything larger is abandoned.
const DISCARD_LIMIT_BYTES = 16 * 1024 * 1024;

async function discardRemainder(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let discarded = 0;
  try {
    while (discarded <= DISCARD_LIMIT_BYTES) {
      const { done, value } = await reader.read();
      if (done) return;
      discarded += value.byteLength;
    }
  } catch {
    // The client went away.
  }
}

/**
 * Reads and drops an unread request body before an early error response, so
 * the client (mid-upload) sees that response instead of a dropped connection.
 */
export async function discardRequestBody(request: Request) {
  if (!request.body || request.bodyUsed) return;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > DISCARD_LIMIT_BYTES) return;
  await discardRemainder(request.body.getReader());
}

/**
 * Reads a request body into memory, refusing more than `maxBytes` whether or
 * not the client sent an honest Content-Length.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number, tooLarge: string) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (request.body && declared <= maxBytes + DISCARD_LIMIT_BYTES) {
      await discardRemainder(request.body.getReader());
    }
    throw new RequestError(413, tooLarge);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await discardRemainder(reader);
      throw new RequestError(413, tooLarge);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Parses a JSON object body (application/json only). */
export async function readJsonObject(request: Request) {
  if (mediaType(request) !== "application/json") {
    await discardRequestBody(request);
    throw new RequestError(415, "Send this request as JSON (Content-Type: application/json).");
  }
  const body = await readBodyWithLimit(request, JSON_MAX_BYTES, "That request is too large.");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new RequestError(400, "The request body is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestError(400, "The request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

/** Parses a multipart/form-data body of at most one photo plus text fields. */
export async function readMultipartForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (mediaType(request) !== "multipart/form-data") {
    await discardRequestBody(request);
    throw new RequestError(415, "Send this request as multipart/form-data.");
  }
  const body = await readBodyWithLimit(
    request,
    MULTIPART_MAX_BYTES,
    "Please use a photo smaller than 10 MB.",
  );
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new RequestError(400, "The upload could not be read. Please try again.");
  }
}

/** Collapses whitespace and control characters, then trims. */
export function cleanText(value: string) {
  return value.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
}

/** A text form field: undefined when absent, 400 when it is a file. */
export function formText(form: FormData, field: string, label: string) {
  if (!form.has(field)) return undefined;
  const value = form.get(field);
  if (typeof value !== "string") {
    throw new RequestError(400, `${label} must be text.`);
  }
  return cleanText(value);
}

/** A JSON text field: undefined when absent, 400 when not a string. */
export function jsonText(payload: Record<string, unknown>, field: string, label: string) {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RequestError(400, `${label} must be text.`);
  }
  return cleanText(value);
}

export function validateName(value: string, kind: "piece" | "outfit") {
  if (!value) throw new RequestError(400, `Please give the ${kind} a name.`);
  if (value.length > NAME_MAX) {
    throw new RequestError(400, `Names can be at most ${NAME_MAX} characters.`);
  }
  return value;
}

export function validateCategory(value: string) {
  if (!value) throw new RequestError(400, "Please choose a category.");
  if (value.length > CATEGORY_MAX) {
    throw new RequestError(400, `Categories can be at most ${CATEGORY_MAX} characters.`);
  }
  if (value.toLowerCase() === RESERVED_CATEGORY.toLowerCase()) {
    throw new RequestError(400, `"${RESERVED_CATEGORY}" is reserved. Please choose another category name.`);
  }
  return value;
}

export function validateColor(value: string) {
  if (value.length > COLOR_MAX) {
    throw new RequestError(400, `Colours can be at most ${COLOR_MAX} characters.`);
  }
  return value;
}

/** One of SEASONS (matched case-insensitively, returned in canonical form). */
export function validateSeason(value: string) {
  const season = SEASONS.find((option) => option.toLowerCase() === value.toLowerCase());
  if (!season) {
    throw new RequestError(400, `Season must be one of: ${SEASONS.join(", ")}.`);
  }
  return season;
}

/** One of OCCASIONS (matched case-insensitively, returned in canonical form). */
export function validateOccasion(value: string) {
  const occasion = OCCASIONS.find((option) => option.toLowerCase() === value.toLowerCase());
  if (!occasion) {
    throw new RequestError(400, `Occasion must be one of: ${OCCASIONS.join(", ")}.`);
  }
  return occasion;
}

/** 1..OUTFIT_ITEMS_MAX unique positive integer item ids. */
export function validateItemIds(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) {
    throw new RequestError(400, "Choose the pieces for this outfit.");
  }
  if (value.length === 0) {
    throw new RequestError(400, "Choose at least one piece for this outfit.");
  }
  if (value.length > maxItems) {
    throw new RequestError(400, `An outfit can have at most ${maxItems} pieces.`);
  }
  if (!value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    throw new RequestError(400, "Some of the chosen pieces are not valid.");
  }
  if (new Set(value).size !== value.length) {
    throw new RequestError(400, "Each piece can only be added to an outfit once.");
  }
  return value as number[];
}

/**
 * The uploaded photo, checked by size and by its real leading bytes. Throws
 * a 400/413 RequestError with a message for the user.
 */
export async function validateImage(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) {
    throw new RequestError(400, "Please choose a photo of the piece.");
  }
  if (value.size > IMAGE_MAX_BYTES) {
    throw new RequestError(413, "Please use a photo smaller than 10 MB.");
  }

  const signature = new Uint8Array(await value.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer());
  const type = detectImageType(signature);
  if (type === "image/avif") {
    throw new RequestError(
      400,
      "AVIF photos are not supported. Please use a JPG, PNG, WebP, or HEIC photo.",
      "unsupported_image",
    );
  }
  if (!type) {
    throw new RequestError(
      400,
      "That file is not a supported photo. Please use a JPG, PNG, WebP, or HEIC image.",
      "unsupported_image",
    );
  }
  return value;
}
