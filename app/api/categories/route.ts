import {
  apiError,
  findCategory,
  getWardrobeDb,
  loadCategories,
  NO_STORE,
  requireOwner,
} from "../../lib/wardrobe-store";
import {
  jsonText,
  readJsonObject,
  RequestError,
  validateCategory,
} from "../../lib/wardrobe-input";

export const dynamic = "force-dynamic";

function duplicate(name: string) {
  return new RequestError(409, `"${name}" is already a category.`, "duplicate");
}

/** Every category, pieces or not: {categories: {name, count}[]} sorted by name. */
export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    const categories = await loadCategories(getWardrobeDb(), owner);
    return Response.json({ categories }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}

/** JSON {name}. 409 when a category matches it case-insensitively. */
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const payload = await readJsonObject(request);
    const name = validateCategory(
      jsonText(payload, "name", "Name") ?? "",
      "Please give the category a name.",
    );

    const db = getWardrobeDb();
    const existing = findCategory(name, await loadCategories(db, owner));
    if (existing) throw duplicate(existing.name);

    // The unique index settles a race with another device.
    const row = await db
      .prepare("INSERT OR IGNORE INTO categories (owner, name) VALUES (?, ?) RETURNING name")
      .bind(owner, name)
      .first<{ name: string }>();
    if (!row) throw duplicate(name);

    return Response.json(
      { category: { name: row.name, count: 0 } },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return apiError(error);
  }
}
