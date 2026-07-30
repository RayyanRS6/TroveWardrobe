import {
  apiError,
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
      return Response.json({ error: "Invalid outfit." }, { status: 400 });
    }

    const owner = getOwner(request);
    const db = await getWardrobeDb();
    const result = await db
      .prepare("DELETE FROM outfits WHERE id = ? AND owner = ?")
      .bind(id, owner)
      .run();

    if (!result.meta.changes) {
      return Response.json({ error: "Outfit not found." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
