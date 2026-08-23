import {
  apiError,
  getOwner,
  getWardrobeDb,
} from "../../../lib/wardrobe-store";
import { getB2Object } from "../../../lib/b2-storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) {
      return new Response("Invalid image", { status: 400 });
    }

    const owner = getOwner(request);
    const db = await getWardrobeDb();
    const row = await db
      .prepare(
        "SELECT image_key, image_version, image_type FROM wardrobe_items WHERE id = ? AND owner = ?",
      )
      .bind(id, owner)
      .first<{ image_key: string; image_version: string; image_type: string }>();

    if (!row) return new Response("Image not found", { status: 404 });
    const object = await getB2Object(row.image_key, row.image_version);
    if (!object) return new Response("Image not found", { status: 404 });
    const headers = new Headers({
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": row.image_type,
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = object.headers.get("content-length");
    const etag = object.headers.get("etag");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (etag) headers.set("ETag", etag);

    return new Response(object.body, { headers });
  } catch (error) {
    return apiError(error);
  }
}
