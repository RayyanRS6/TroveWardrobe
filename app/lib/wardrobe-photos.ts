import {
  assertB2Configured,
  getB2StorageLimitBytes,
  putB2Object,
  type StoredObject,
} from "./b2-storage";
import { createWardrobeRenditions } from "./image-processing";
import { RequestError } from "./wardrobe-input";
import { storageBytesUsed } from "./wardrobe-store";

export type StoredPhoto = {
  imageKey: string;
  imageVersion: string;
  imageType: string;
  imageSize: number;
  thumbKey: string;
  thumbVersion: string;
  thumbSize: number;
};

export function storageFull() {
  return new RequestError(
    507,
    "Your photo storage safety limit has been reached. Delete some pieces to add more.",
  );
}

/**
 * Checks Backblaze settings and the storage limit before any image
 * transformation is spent. `freedBytes` is what a replaced photo gives back.
 * The upload size stands in for the (usually smaller) WebP renditions; the
 * database write re-checks with the real sizes.
 */
export async function assertPhotoFits(db: D1Database, uploadBytes: number, freedBytes = 0) {
  assertB2Configured();
  const limit = getB2StorageLimitBytes();
  if ((await storageBytesUsed(db)) - freedBytes + uploadBytes > limit) {
    throw storageFull();
  }
  return limit;
}

/**
 * Makes the display and thumbnail renditions and uploads both to B2. Every
 * object that reaches B2 is pushed onto `uploaded` so the caller can roll
 * back if a later step fails.
 */
export async function storePhoto(image: File, uploaded: StoredObject[]): Promise<StoredPhoto> {
  const { display, thumbnail } = await createWardrobeRenditions(image);
  const id = crypto.randomUUID();
  const imageKey = `clothes/${id}.${display.extension}`;
  const thumbKey = `clothes/${id}-thumb.${thumbnail.extension}`;

  const [imageUpload, thumbUpload] = await Promise.allSettled([
    putB2Object(imageKey, display.bytes, display.contentType),
    putB2Object(thumbKey, thumbnail.bytes, thumbnail.contentType),
  ]);
  if (imageUpload.status === "fulfilled") {
    uploaded.push({ key: imageKey, version: imageUpload.value });
  }
  if (thumbUpload.status === "fulfilled") {
    uploaded.push({ key: thumbKey, version: thumbUpload.value });
  }
  if (imageUpload.status === "rejected") throw imageUpload.reason;
  if (thumbUpload.status === "rejected") throw thumbUpload.reason;

  return {
    imageKey,
    imageVersion: imageUpload.value,
    imageType: display.contentType,
    imageSize: display.bytes.byteLength,
    thumbKey,
    thumbVersion: thumbUpload.value,
    thumbSize: thumbnail.bytes.byteLength,
  };
}
