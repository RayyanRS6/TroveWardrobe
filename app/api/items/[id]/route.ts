import {
  apiError,
  getImageBucket,
  getOwner,
  getWardrobeDb,
} from "../../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid item." }, { status: 400 });
    }

    const owner = getOwner(request);
    const db = await getWardrobeDb();
    const row = await db
      .prepare(
        "SELECT image_key FROM wardrobe_items WHERE id = ? AND owner = ?",
      )
      .bind(id, owner)
      .first<{ image_key: string }>();

    if (!row) {
      return Response.json({ error: "Item not found." }, { status: 404 });
    }

    await db
      .prepare("DELETE FROM wardrobe_items WHERE id = ? AND owner = ?")
      .bind(id, owner)
      .run();
    await getImageBucket().delete(row.image_key);

    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
