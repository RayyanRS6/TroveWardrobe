import {
  addCategoryIfMissing,
  apiError,
  findCategory,
  getWardrobeDb,
  LISTED_CATEGORY,
  loadCategories,
  NO_STORE,
  requireOwner,
} from "../../../lib/wardrobe-store";
import { RequestError } from "../../../lib/wardrobe-input";
import { UNCATEGORIZED } from "../../../lib/wardrobe-options";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

function categoryNotFound() {
  return new RequestError(404, "That category no longer exists.");
}

/**
 * DELETE /api/categories/:name (URL-encoded; the exact name, else matched
 * case-insensitively, see findCategory): {ok: true, moved}. Its pieces move to UNCATEGORIZED, which is created when
 * needed and can itself be deleted only once it is empty.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { name: rawName } = await context.params;

    const db = getWardrobeDb();
    const category = findCategory(rawName, await loadCategories(db, owner));
    if (!category) throw categoryNotFound();
    const isUncategorized = category.name.toLowerCase() === UNCATEGORIZED.toLowerCase();

    // One transaction: add UNCATEGORIZED if there are pieces to move, move
    // them, then delete the category unless pieces remain (only possible
    // when it is UNCATEGORIZED itself).
    const hasPieces = `EXISTS (
      SELECT 1 FROM wardrobe_items WHERE owner = ? AND lower(category) = lower(?)
    )`;
    const remove = db
      .prepare(
        `DELETE FROM categories
         WHERE owner = ? AND lower(name) = lower(?) AND NOT ${hasPieces}
         RETURNING name`,
      )
      .bind(owner, category.name, owner, category.name);
    const results = await db.batch(
      isUncategorized
        ? [remove]
        : [
            addCategoryIfMissing(db, owner, UNCATEGORIZED, hasPieces, [owner, category.name]),
            db
              .prepare(
                `UPDATE wardrobe_items SET category = ${LISTED_CATEGORY}
                 WHERE owner = ? AND lower(category) = lower(?)`,
              )
              .bind(owner, UNCATEGORIZED, owner, category.name),
            remove,
          ],
    );

    if (!results[results.length - 1].results.length) {
      if (!findCategory(category.name, await loadCategories(db, owner))) {
        throw categoryNotFound();
      }
      throw new RequestError(409, "Move these pieces to another category first.", "not_empty");
    }
    const moved = isUncategorized ? 0 : results[1].meta.changes;
    return Response.json({ ok: true, moved }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
