import {
  addCategoryIfMissing,
  apiError,
  canonicalCategory,
  getWardrobeDb,
  ITEM_COLUMNS,
  itemResponse,
  LISTED_CATEGORY,
  loadCategories,
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
} from "../../../lib/wardrobe-input";
import {
  assertPhotoFits,
  runToCompletion,
  storageFull,
  storePhoto,
} from "../../../lib/wardrobe-photos";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type StoredItemRow = WardrobeItemRow & {
  image_size: number;
  thumb_size: number;
};

function itemNotFound() {
  return new RequestError(404, "That piece no longer exists.");
}

function photoChanged() {
  return new RequestError(
    409,
    "This piece's photo was just changed on another device. Please reopen it and try again.",
    "conflict",
  );
}

/** Multipart with any of: name, category, color, image. */
export async function PATCH(request: Request, context: RouteContext) {
  // A new photo's upload, the update and the old photo's deletion (or the
  // rollback) finish even if the client disconnects.
  return runToCompletion(updateItem(request, context));
}

async function updateItem(request: Request, context: RouteContext) {
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
    const categoryInput = formText(form, "category", "Category");
    const category =
      categoryInput === undefined
        ? undefined
        : canonicalCategory(validateCategory(categoryInput), await loadCategories(db, owner));
    if (category !== undefined) {
      assignments.push(`category = ${LISTED_CATEGORY}`);
      values.push(owner, category);
    }
    const color = formText(form, "color", "Colour");
    if (color !== undefined) assign("color", validateColor(color));

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

    // With a new photo, re-check the limit with the real sizes atomically,
    // and replace only the photo read above: one saved meanwhile elsewhere
    // would otherwise be orphaned.
    const quotaCheck = quota
      ? ` AND image_key = ?
          AND (SELECT COALESCE(SUM(image_size + thumb_size), 0) FROM wardrobe_items)
            - (image_size + thumb_size) + ? <= ?`
      : "";
    const where = `id = ? AND owner = ?${quotaCheck}`;
    const whereValues = [id, owner, ...(quota ? [existing.image_key, ...quota] : [])];
    const update = db
      .prepare(
        `UPDATE wardrobe_items SET ${assignments.join(", ")}
         WHERE ${where}
         RETURNING ${ITEM_COLUMNS}`,
      )
      .bind(...values, ...whereValues);
    // A new category joins the list in the same transaction, only with the update.
    const results = await db.batch<WardrobeItemRow>(
      category === undefined
        ? [update]
        : [
            addCategoryIfMissing(
              db,
              owner,
              category,
              `EXISTS (SELECT 1 FROM wardrobe_items WHERE ${where})`,
              whereValues,
            ),
            update,
          ],
    );
    const row = results[results.length - 1].results[0];

    if (!row) {
      const current = await db
        .prepare("SELECT image_key FROM wardrobe_items WHERE id = ? AND owner = ?")
        .bind(id, owner)
        .first<{ image_key: string }>();
      if (!current || !quota) throw itemNotFound();
      throw current.image_key === existing.image_key ? storageFull() : photoChanged();
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
  // The row and its photos go together even if the client disconnects.
  return runToCompletion(deleteItem(request, context));
}

type PhotoKeys = {
  image_key: string;
  image_version: string;
  thumb_key: string;
  thumb_version: string;
};

async function deleteItem(request: Request, context: RouteContext) {
  try {
    const owner = await requireOwner(request);
    const { id: rawId } = await context.params;
    const id = parseId(rawId, "piece");

    // Remove the item and every outfit reference to it in one transaction.
    // The photo keys come from the deleted row itself, so a photo replaced
    // meanwhile is not left behind.
    const db = getWardrobeDb();
    const [deleted] = await db.batch<PhotoKeys>([
      db
        .prepare(
          `DELETE FROM wardrobe_items WHERE id = ? AND owner = ?
           RETURNING image_key, image_version, thumb_key, thumb_version`,
        )
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
    const row = deleted.results[0];
    if (!row) throw itemNotFound();

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
