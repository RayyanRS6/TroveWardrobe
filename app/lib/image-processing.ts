import { env } from "cloudflare:workers";

const OUTPUT_CONTENT_TYPE = "image/webp";

// Display photo and grid thumbnail. The thumbnail is cut from the display
// rendition: a much smaller input, already rotated and resized once.
const DISPLAY = { width: 1600, quality: 82 } as const;
const THUMBNAIL = { width: 480, quality: 75 } as const;

export class ImageProcessingError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export type ImageRendition = {
  bytes: ArrayBuffer;
  contentType: typeof OUTPUT_CONTENT_TYPE;
  extension: "webp";
};

export type DetectedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "image/avif";

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const GENERIC_HEIF_BRANDS = new Set(["mif1", "msf1"]);

/** Bytes needed by detectImageType. */
export const IMAGE_SIGNATURE_BYTES = 64;

/**
 * Identifies an image by its leading bytes (magic numbers), never by the
 * file name or the browser-supplied type. Returns null for anything else.
 */
export function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return "image/gif";
  }
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    // ISO-BMFF: major brand, then compatible brands up to the box size.
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    const brands = [ascii(8, 12)];
    for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      brands.push(ascii(offset, offset + 4));
    }
    const major = brands[0];
    if (AVIF_BRANDS.has(major)) return "image/avif";
    if (HEIF_BRANDS.has(major)) return "image/heic";
    if (GENERIC_HEIF_BRANDS.has(major)) {
      if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image/heic";
      if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "image/avif";
    }
  }
  return null;
}

async function transform(
  stream: ReadableStream<Uint8Array>,
  options: { width: number; quality: number },
): Promise<ImageRendition> {
  try {
    const result = await env.IMAGES.input(stream)
      .transform({ width: options.width, fit: "scale-down" })
      .output({ format: OUTPUT_CONTENT_TYPE, quality: options.quality, anim: false });
    const response = result.response();

    if (!response.ok) {
      await response.body?.cancel();
      throw new ImageProcessingError(
        `Cloudflare Images returned status ${response.status}.`,
      );
    }

    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) {
      throw new ImageProcessingError("Cloudflare Images returned an empty image.");
    }

    return {
      bytes,
      contentType: OUTPUT_CONTENT_TYPE,
      extension: "webp",
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;

    const code = imageErrorCode(error);
    throw new ImageProcessingError(
      error instanceof Error ? error.message : "Image optimization failed.",
      code,
    );
  }
}

/**
 * Two WebP renditions of an uploaded photo: display (1600 px wide at most)
 * and thumbnail (480 px). Costs two Cloudflare Images transformations.
 */
export async function createWardrobeRenditions(image: Blob) {
  const display = await transform(image.stream(), DISPLAY);
  const thumbnail = await transform(new Blob([display.bytes]).stream(), THUMBNAIL);
  return { display, thumbnail };
}

function imageErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }
  // The binding reports some failures only as "ERROR <code>: ..." messages.
  const match = error instanceof Error ? /\b(9\d{3})\b/.exec(error.message) : null;
  return match ? Number(match[1]) : undefined;
}
