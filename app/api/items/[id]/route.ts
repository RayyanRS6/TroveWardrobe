import {
  apiError,
  canonicalCategory,
  getWardrobeDb,
  ITEM_COLUMNS,
  itemResponse,
  loadCategoryCounts,
  NO_STORE,
  requireOwner,
  type WardrobeItemRow,
} from "../../../lib/wardrobe-store";
import { deleteB2ObjectsQuietly, type StoredObject } from "../../../lib/b2-storage";
import {
  formText,
  parseId,
  readMultipartForm,
  RequestError,
  validateCategory,
  validateColor,
  validateImage,
  validateName,
  validateSeason,
} from "../../../lib/wardrobe-input";
import { assertPhotoFits, storageFull, storePhoto } from "../../../lib/wardrobe-photos";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type StoredItemRow = WardrobeItemRow & {
  image_size: number;
  thumb_size: number;
};

function itemNotFound() {
  return new RequestError(404, "That piece no longer exists.");
}

/** Multipart with any of: name, category, color, season, image. */
export async function PATCH(request: Request, context: RouteContext) {
  const uploaded: StoredObject[] = [];

  try {
    const owner = await requireOwner(request);
    const { id: rawId } = await context.params;
    const id = parseId(rawId, "piece");
    const form = await readMultipartForm(request);

    const db = getWardrobeDb();
    const existing = await db
      .prepare(
        `SELECT ${ITEM_COLUMNS}, image_size, thumb_size
         FROM wardrobe_items WHERE id = ? AND owner = ?`,
      )
      .bind(id, owner)
      .first<StoredItemRow>();
    if (!existing) throw itemNotFound();

    const assignments: string[] = [];
    const values: (string | number)[] = [];
    const assign = (column: string, value: string | number) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    const name = formText(form, "name", "Name");
    if (name !== undefined) assign("name", validateName(name, "piece"));
    const category = formText(form, "category", "Category");
    if (category !== undefined) {
      assign(
        "category",
        canonicalCategory(
          validateCategory(category),
          await loadCategoryCounts(db, owner, id),
        ),
      );
    }
    const color = formText(form, "color", "Colour");
    if (color !== undefined) assign("color", validateColor(color));
    const season = formText(form, "season", "Season");
    if (season !== undefined) assign("season", validateSeason(season));

    // An untouched <input type="file"> submits an empty, unnamed file; an
    // empty text value also keeps the current photo.
    const imageEntry = form.get("image");
    const replacesPhoto =
      imageEntry !== null &&
      imageEntry !== "" &&
      !(imageEntry instanceof File && imageEntry.size === 0 && !imageEntry.name);
    let quota: [number, number] | null = null;
    if (replacesPhoto) {
      const image = await validateImage(imageEntry);
      const storageLimit = await assertPhotoFits(
        db,
        image.size,
        existing.image_size + existing.thumb_size,
      );
      const photo = await storePhoto(image, uploaded);
      assign("image_key", photo.imageKey);
      assign("image_version", photo.imageVersion);
      assign("image_type", photo.imageType);
      assign("image_size", photo.imageSize);
      assign("thumb_key", photo.thumbKey);
      assign("thumb_version", photo.thumbVersion);
      assign("thumb_size", photo.thumbSize);
      quota = [photo.imageSize + photo.thumbSize, storageLimit];
    }

    if (!assignments.length) {
      throw new RequestError(400, "Nothing to update. Send at least one detail or a new photo.");
    }

    // With a new photo, re-check the limit with the real sizes atomically.
    const quotaCheck = quota
      ? ` AND (SELECT COALESCE(SUM(image_size + thumb_size), 0) FROM wardrobe_items)
            - (image_size + thumb_size) + ? <= ?`
      : "";
    const row = await db
      .prepare(
        `UPDATE wardrobe_items SET ${assignments.join(", ")}
         WHERE id = ? AND owner = ?${quotaCheck}
         RETURNING ${ITEM_COLUMNS}`,
      )
      .bind(...values, id, owner, ...(quota ?? []))
      .first<WardrobeItemRow>();

    if (!row) {
      const stillExists = await db
        .prepare("SELECT 1 FROM wardrobe_items WHERE id = ? AND owner = ?")
        .bind(id, owner)
        .first();
      throw stillExists && quota ? storageFull() : itemNotFound();
    }

    uploaded.length = 0;
    if (quota) {
      await deleteB2ObjectsQuietly(
        [
          { key: existing.image_key, version: existing.image_version },
          { key: existing.thumb_key, version: existing.thumb_version },
        ],
        "replaced photo",
      );
    }
    return Response.json({ item: itemResponse(row) }, { headers: NO_STORE });
  } catch (error) {
    await deleteB2ObjectsQuietly(uploaded, "upload rollback");
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id: rawId } = await context.params;
    const id = parseId(rawId, "piece");

    const db = getWardrobeDb();
    const row = await db
      .prepare(
        `SELECT image_key, image_version, thumb_key, thumb_version
         FROM wardrobe_items WHERE id = ? AND owner = ?`,
      )
      .bind(id, owner)
      .first<{
        image_key: string;
        image_version: string;
        thumb_key: string;
        thumb_version: string;
      }>();
    if (!row) throw itemNotFound();

    // Remove the item and every outfit reference to it in one transaction.
    const [deleted] = await db.batch([
      db
        .prepare("DELETE FROM wardrobe_items WHERE id = ? AND owner = ?")
        .bind(id, owner),
      db
        .prepare(
          `UPDATE outfits
           SET item_ids = (
             SELECT json_group_array(value) FROM (
               SELECT value FROM json_each(outfits.item_ids)
               WHERE value <> ?1
               ORDER BY key
             )
           )
           WHERE owner = ?2
             AND json_valid(item_ids)
             AND EXISTS (SELECT 1 FROM json_each(outfits.item_ids) WHERE value = ?1)`,
        )
        .bind(id, owner),
    ]);
    if (!deleted.meta.changes) throw itemNotFound();

    // The row is gone; storage cleanup is best effort (failures are logged).
    await deleteB2ObjectsQuietly(
      [
        { key: row.image_key, version: row.image_version },
        { key: row.thumb_key, version: row.thumb_version },
      ],
      "item deleted",
    );
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
