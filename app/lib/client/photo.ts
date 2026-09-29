// Prepares a chosen photo before upload: decodes it, shrinks it to at most
// 1600 px on the long edge and re-encodes it as WebP (JPEG where the browser
// cannot encode WebP). Phones take 5-15 MB photos; this keeps uploads to a few
// hundred KB. Photos the browser cannot decode (HEIC outside Safari) go up
// unchanged when they fit the limit; the server converts them.

import { IMAGE_MAX_BYTES } from "../wardrobe-options";
import { formatBytes } from "./format";

/** For <input type="file" accept>. Extensions help pickers that lack HEIC types. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

const MAX_EDGE = 1600;
const QUALITY = 0.85;

/** A problem with the chosen file, worded for the user. */
export class PhotoError extends Error {}

export type PreparedPhoto = {
  file: File;
  /** False when this browser cannot show the photo (it is still uploadable). */
  previewable: boolean;
};

const tooLarge = (size: number) =>
  new PhotoError(
    `This photo is ${formatBytes(size)}, and this browser can't shrink it. Please choose a photo smaller than 10 MB.`,
  );

function looksLikePhoto(file: File) {
  return file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Unsupported format or option: try an <img> below.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty image");
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

async function encode(image: Decoded, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, width, height);

  // Browsers without a WebP encoder silently return PNG instead.
  const webp = await canvasBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;

  // JPEG has no transparency: paint transparent areas white, not black.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  const jpeg = await canvasBlob(canvas, "image/jpeg");
  return jpeg?.type === "image/jpeg" ? jpeg : null;
}

function renamed(original: string, type: string) {
  const base = original.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.${type === "image/webp" ? "webp" : "jpg"}`;
}

/** Throws PhotoError with a message for the user. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!looksLikePhoto(file)) {
    throw new PhotoError("That file isn't a photo. Please choose a JPG, PNG, WebP or HEIC image.");
  }

  const image = await decode(file);
  if (!image) {
    if (file.size > IMAGE_MAX_BYTES) throw tooLarge(file.size);
    return { file, previewable: false };
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const blob = await encode(image, width, height);

    // Keep an already small original rather than a larger re-encode.
    const keepOriginal =
      !blob || (scale === 1 && file.size <= blob.size && file.size <= IMAGE_MAX_BYTES);
    if (keepOriginal) {
      if (file.size > IMAGE_MAX_BYTES) throw tooLarge(file.size);
      return { file, previewable: true };
    }
    if (blob.size > IMAGE_MAX_BYTES) throw tooLarge(file.size);
    return {
      file: new File([blob], renamed(file.name, blob.type), { type: blob.type }),
      previewable: true,
    };
  } finally {
    image.release();
  }
}
