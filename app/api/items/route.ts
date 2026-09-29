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
} from "../../lib/wardrobe-store";
import { deleteB2ObjectsQuietly, type StoredObject } from "../../lib/b2-storage";
import {
  formText,
  readMultipartForm,
  validateCategory,
  validateColor,
  validateImage,
  validateName,
} from "../../lib/wardrobe-input";
import {
  assertPhotoFits,
  runToCompletion,
  storageFull,
  storePhoto,
} from "../../lib/wardrobe-photos";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const db = getWardrobeDb();
    const result = await db
      .prepare(
        `SELECT ${ITEM_COLUMNS}
         FROM wardrobe_items
         WHERE owner = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(owner)
      .all<WardrobeItemRow>();

    return Response.json(
      { items: result.results.map(itemResponse) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  // The upload, the insert and any rollback finish even if the client
  // disconnects, so no photo is left in B2 without a row.
  return runToCompletion(createItem(request));
}

async function createItem(request: Request) {
  const uploaded: StoredObject[] = [];

  try {
    const owner = await requireOwner(request);
    const form = await readMultipartForm(request);
    const name = validateName(formText(form, "name", "Name") ?? "", "piece");
    const categoryInput = validateCategory(formText(form, "category", "Category") ?? "");
    const color = validateColor(formText(form, "color", "Colour") ?? "");
    const image = await validateImage(form.get("image"));

    const db = getWardrobeDb();
    const category = canonicalCategory(categoryInput, await loadCategories(db, owner));

    const storageLimit = await assertPhotoFits(db, image.size);
    const photo = await storePhoto(image, uploaded);

    // Re-checks the limit with the real sizes, atomically with the insert. A
    // new category joins the list in the same transaction, only with the piece.
    const fits = `(
      SELECT COALESCE(SUM(image_size + thumb_size), 0) FROM wardrobe_items
    ) + ? <= ?`;
    const quota = [photo.imageSize + photo.thumbSize, storageLimit];
    const [, inserted] = await db.batch<WardrobeItemRow>([
      addCategoryIfMissing(db, owner, category, fits, quota),
      db
        .prepare(
          `INSERT INTO wardrobe_items
            (owner, name, category, color,
             image_key, image_version, image_type, image_size,
             thumb_key, thumb_version, thumb_size)
           SELECT ?, ?, ${LISTED_CATEGORY}, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE ${fits}
           RETURNING ${ITEM_COLUMNS}`,
        )
        .bind(
          owner,
          name,
          owner,
          category,
          color,
          photo.imageKey,
          photo.imageVersion,
          photo.imageType,
          photo.imageSize,
          photo.thumbKey,
          photo.thumbVersion,
          photo.thumbSize,
          ...quota,
        ),
    ]);

    const row = inserted.results[0];
    if (!row) throw storageFull();
    uploaded.length = 0;
    return Response.json({ item: itemResponse(row) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    await deleteB2ObjectsQuietly(uploaded, "upload rollback");
    return apiError(error);
  }
}
