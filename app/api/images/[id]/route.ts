import {
  apiError,
  getImageBucket,
  getOwner,
  getWardrobeDb,
} from "../../../lib/wardrobe-store";

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
        "SELECT image_key, image_type FROM wardrobe_items WHERE id = ? AND owner = ?",
      )
      .bind(id, owner)
      .first<{ image_key: string; image_type: string }>();

    if (!row) return new Response("Image not found", { status: 404 });
    const object = await getImageBucket().get(row.image_key);
    if (!object) return new Response("Image not found", { status: 404 });

    return new Response(object.body, {
      headers: {
        "Content-Type": row.image_type,
        "Cache-Control": "private, max-age=86400",
        ETag: object.httpEtag,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
