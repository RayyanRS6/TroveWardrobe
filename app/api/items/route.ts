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
} from "../../lib/wardrobe-store";
import { deleteB2ObjectsQuietly, type StoredObject } from "../../lib/b2-storage";
import {
  formText,
  readMultipartForm,
  validateCategory,
  validateColor,
  validateImage,
  validateName,
  validateSeason,
} from "../../lib/wardrobe-input";
import { assertPhotoFits, storageFull, storePhoto } from "../../lib/wardrobe-photos";
import { DEFAULT_SEASON } from "../../lib/wardrobe-options";

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
  const uploaded: StoredObject[] = [];

  try {
    const owner = await requireOwner(request);
    const form = await readMultipartForm(request);
    const name = validateName(formText(form, "name", "Name") ?? "", "piece");
    const categoryInput = validateCategory(formText(form, "category", "Category") ?? "");
    const color = validateColor(formText(form, "color", "Colour") ?? "");
    const seasonInput = formText(form, "season", "Season");
    const season = seasonInput ? validateSeason(seasonInput) : DEFAULT_SEASON;
    const image = await validateImage(form.get("image"));

    const db = getWardrobeDb();
    const category = canonicalCategory(
      categoryInput,
      await loadCategoryCounts(db, owner),
    );

    const storageLimit = await assertPhotoFits(db, image.size);
    const photo = await storePhoto(image, uploaded);

    // Re-checks the limit with the real sizes, atomically with the insert.
    const row = await db
      .prepare(
        `INSERT INTO wardrobe_items
          (owner, name, category, color, season,
           image_key, image_version, image_type, image_size,
           thumb_key, thumb_version, thumb_size)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (
           SELECT COALESCE(SUM(image_size + thumb_size), 0)
           FROM wardrobe_items
         ) + ? <= ?
         RETURNING ${ITEM_COLUMNS}`,
      )
      .bind(
        owner,
        name,
        category,
        color,
        season,
        photo.imageKey,
        photo.imageVersion,
        photo.imageType,
        photo.imageSize,
        photo.thumbKey,
        photo.thumbVersion,
        photo.thumbSize,
        photo.imageSize + photo.thumbSize,
        storageLimit,
      )
      .first<WardrobeItemRow>();

    if (!row) throw storageFull();
    uploaded.length = 0;
    return Response.json({ item: itemResponse(row) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    await deleteB2ObjectsQuietly(uploaded, "upload rollback");
    return apiError(error);
  }
}
