import {
  apiError,
  getWardrobeDb,
  NO_STORE,
  OUTFIT_COLUMNS,
  outfitResponse,
  requireOwner,
  type OutfitRow,
} from "../../lib/wardrobe-store";
import {
  jsonText,
  readJsonObject,
  RequestError,
  validateItemIds,
  validateName,
  validateOccasion,
} from "../../lib/wardrobe-input";
import { DEFAULT_OCCASION, OUTFIT_ITEMS_MAX } from "../../lib/wardrobe-options";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const db = getWardrobeDb();
    const result = await db
      .prepare(
        `SELECT ${OUTFIT_COLUMNS}
         FROM outfits
         WHERE owner = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(owner)
      .all<OutfitRow>();

    return Response.json(
      { outfits: result.results.map(outfitResponse) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return apiError(error);
  }
}

/** JSON {name, occasion?, itemIds}. */
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const payload = await readJsonObject(request);
    const name = validateName(jsonText(payload, "name", "Name") ?? "", "outfit");
    const occasionInput = jsonText(payload, "occasion", "Occasion");
    const occasion =
      occasionInput === undefined ? DEFAULT_OCCASION : validateOccasion(occasionInput);
    const itemIds = validateItemIds(payload.itemIds, OUTFIT_ITEMS_MAX);

    // Inserts only if every piece exists and belongs to the owner.
    const db = getWardrobeDb();
    const row = await db
      .prepare(
        `INSERT INTO outfits (owner, name, occasion, item_ids)
         SELECT ?1, ?2, ?3, ?4
         WHERE (
           SELECT COUNT(*) FROM wardrobe_items
           WHERE owner = ?1 AND id IN (SELECT value FROM json_each(?4))
         ) = ?5
         RETURNING ${OUTFIT_COLUMNS}`,
      )
      .bind(owner, name, occasion, JSON.stringify(itemIds), itemIds.length)
      .first<OutfitRow>();

    if (!row) {
      throw new RequestError(
        400,
        "Some of the chosen pieces no longer exist. Refresh and try again.",
      );
    }
    return Response.json({ outfit: outfitResponse(row) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
