import {
  apiError,
  getWardrobeDb,
  NO_STORE,
  OUTFIT_COLUMNS,
  outfitResponse,
  requireOwner,
  type OutfitRow,
} from "../../../lib/wardrobe-store";
import {
  jsonText,
  parseId,
  readJsonObject,
  RequestError,
  validateItemIds,
  validateName,
  validateOccasion,
} from "../../../lib/wardrobe-input";
import { OUTFIT_ITEMS_MAX } from "../../../lib/wardrobe-options";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function outfitNotFound() {
  return new RequestError(404, "That outfit no longer exists.");
}

/** JSON with any of: name, occasion, itemIds. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id: rawId } = await context.params;
    const id = parseId(rawId, "outfit");
    const payload = await readJsonObject(request);

    const assignments: string[] = [];
    const values: (string | number)[] = [];
    const name = jsonText(payload, "name", "Name");
    if (name !== undefined) {
      assignments.push("name = ?");
      values.push(validateName(name, "outfit"));
    }
    const occasion = jsonText(payload, "occasion", "Occasion");
    if (occasion !== undefined) {
      assignments.push("occasion = ?");
      values.push(validateOccasion(occasion));
    }
    const itemIds =
      payload.itemIds === undefined
        ? null
        : validateItemIds(payload.itemIds, OUTFIT_ITEMS_MAX);
    if (itemIds) {
      assignments.push("item_ids = ?");
      values.push(JSON.stringify(itemIds));
    }
    if (!assignments.length) {
      throw new RequestError(400, "Nothing to update. Send a name, occasion, or itemIds.");
    }

    // With new pieces, updates only if every piece exists and is owned.
    const piecesCheck = itemIds
      ? ` AND (
            SELECT COUNT(*) FROM wardrobe_items
            WHERE owner = ? AND id IN (SELECT value FROM json_each(?))
          ) = ?`
      : "";
    const db = getWardrobeDb();
    const row = await db
      .prepare(
        `UPDATE outfits SET ${assignments.join(", ")}
         WHERE id = ? AND owner = ?${piecesCheck}
         RETURNING ${OUTFIT_COLUMNS}`,
      )
      .bind(
        ...values,
        id,
        owner,
        ...(itemIds ? [owner, JSON.stringify(itemIds), itemIds.length] : []),
      )
      .first<OutfitRow>();

    if (!row) {
      const exists = await db
        .prepare("SELECT 1 FROM outfits WHERE id = ? AND owner = ?")
        .bind(id, owner)
        .first();
      if (!exists) throw outfitNotFound();
      throw new RequestError(
        400,
        "Some of the chosen pieces no longer exist. Refresh and try again.",
      );
    }
    return Response.json({ outfit: outfitResponse(row) }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id: rawId } = await context.params;
    const id = parseId(rawId, "outfit");

    const db = getWardrobeDb();
    const result = await db
      .prepare("DELETE FROM outfits WHERE id = ? AND owner = ?")
      .bind(id, owner)
      .run();

    if (!result.meta.changes) throw outfitNotFound();
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
