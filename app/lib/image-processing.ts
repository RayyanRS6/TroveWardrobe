import { env } from "cloudflare:workers";

const OUTPUT_CONTENT_TYPE = "image/webp";

export class ImageProcessingError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export async function optimizeWardrobeImage(
  stream: ReadableStream<Uint8Array>,
) {
  try {
    const result = await env.IMAGES.input(stream)
      .transform({ width: 1600, fit: "scale-down" })
      .output({ format: OUTPUT_CONTENT_TYPE, quality: 82, anim: false });
    const response = result.response();

    if (!response.ok) {
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
    } as const;
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;

    const code = imageErrorCode(error);
    throw new ImageProcessingError(
      error instanceof Error ? error.message : "Image optimization failed.",
      code,
    );
  }
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
  return undefined;
}
