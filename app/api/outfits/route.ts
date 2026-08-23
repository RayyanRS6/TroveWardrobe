import {
  apiError,
  getOwner,
  getWardrobeDb,
  outfitResponse,
  type OutfitRow,
} from "../../lib/wardrobe-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = getOwner(request);
    const db = getWardrobeDb();
    const result = await db
      .prepare(
        `SELECT id, name, occasion, item_ids
         FROM outfits
         WHERE owner = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(owner)
      .all<OutfitRow>();

    return Response.json({ outfits: result.results.map(outfitResponse) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = getOwner(request);
    const payload = (await request.json()) as {
      name?: string;
      occasion?: string;
      itemIds?: unknown[];
    };
    const name = payload.name?.trim() ?? "";
    const occasion = payload.occasion?.trim() || "Everyday";
    const itemIds = (payload.itemIds ?? [])
      .map(Number)
      .filter(Number.isInteger)
      .slice(0, 12);

    if (!name || itemIds.length === 0) {
      return Response.json(
        { error: "Add a name and choose at least one piece." },
        { status: 400 },
      );
    }

    const db = getWardrobeDb();
    const row = await db
      .prepare(
        `INSERT INTO outfits (owner, name, occasion, item_ids)
         VALUES (?, ?, ?, ?)
         RETURNING id, name, occasion, item_ids`,
      )
      .bind(owner, name, occasion, JSON.stringify(itemIds))
      .first<OutfitRow>();

    if (!row) throw new Error("The outfit could not be saved.");
    return Response.json({ outfit: outfitResponse(row) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
