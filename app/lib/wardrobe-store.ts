import { env } from "cloudflare:workers";
import {
  readAuthSecrets,
  readSessionToken,
  verifySessionToken,
} from "./auth";
import { B2StorageError } from "./b2-storage";
import { ImageProcessingError } from "./image-processing";
import { cleanText, RequestError } from "./wardrobe-input";
import {
  type CategoryCount,
  type Outfit,
  type WardrobeItem,
} from "./wardrobe-options";

/** Trove has one app password, so every row belongs to this owner. */
export const OWNER_ID = "owner";

/** API responses hold private data and must never be cached. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

export type WardrobeItemRow = {
  id: number;
  name: string;
  category: string;
  color: string;
  image_key: string;
  image_version: string;
  thumb_key: string;
  thumb_version: string;
  created_at: string;
};

export const ITEM_COLUMNS =
  "id, name, category, color, image_key, image_version, thumb_key, thumb_version, created_at";

export type OutfitRow = {
  id: number;
  name: string;
  occasion: string;
  item_ids: string;
  created_at: string;
};

export const OUTFIT_COLUMNS = "id, name, occasion, item_ids, created_at";

class WardrobeAuthError extends Error {
  constructor() {
    super("Please sign in again.");
  }
}

/**
 * Verifies the session cookie and returns the owner id. The Worker gate has
 * already checked it; every API handler calls this first anyway, so a routing
 * mistake can never expose the wardrobe.
 */
export async function requireOwner(request: Request) {
  const auth = readAuthSecrets(env);
  if (!auth.secrets) {
    console.error(
      JSON.stringify({ message: "Sign-in is misconfigured", problems: auth.problems }),
    );
    throw new WardrobeAuthError();
  }

  const secure = new URL(request.url).protocol === "https:";
  const token = readSessionToken(request.headers.get("cookie"), secure);
  if (!token || !(await verifySessionToken(token, auth.secrets))) {
    throw new WardrobeAuthError();
  }
  return OWNER_ID;
}

export function getWardrobeDb() {
  return env.DB;
}

/**
 * Short, stable cache-busting tag for an object version (cyrb53). Not a
 * security boundary: image requests are authenticated separately.
 */
export function versionTag(value: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function imageTag(row: Pick<WardrobeItemRow, "image_key" | "image_version">) {
  return versionTag(row.image_version || row.image_key);
}

/** Rows saved before thumbnails existed fall back to the display photo. */
export function thumbTag(
  row: Pick<WardrobeItemRow, "image_key" | "image_version" | "thumb_key" | "thumb_version">,
) {
  return row.thumb_key ? versionTag(row.thumb_version || row.thumb_key) : imageTag(row);
}

/** D1's CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) as ISO 8601. */
function isoTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
}

export function itemResponse(row: WardrobeItemRow): WardrobeItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    imageUrl: `/api/images/${row.id}?v=${imageTag(row)}`,
    thumbUrl: `/api/images/${row.id}?size=thumb&v=${thumbTag(row)}`,
    createdAt: isoTimestamp(row.created_at),
  };
}

export function outfitResponse(row: OutfitRow): Outfit {
  let itemIds: number[] = [];
  try {
    const parsed = JSON.parse(row.item_ids);
    if (Array.isArray(parsed)) {
      itemIds = parsed.filter(Number.isInteger);
    }
  } catch {
    itemIds = [];
  }

  return {
    id: row.id,
    name: row.name,
    occasion: row.occasion,
    itemIds,
    createdAt: isoTimestamp(row.created_at),
  };
}

/** Bytes stored in B2 across all items (display photos plus thumbnails). */
export async function storageBytesUsed(db: D1Database) {
  const usage = await db
    .prepare(
      "SELECT COALESCE(SUM(image_size + thumb_size), 0) AS bytes_used FROM wardrobe_items",
    )
    .first<{ bytes_used: number }>();
  return usage?.bytes_used ?? 0;
}

// Categories are one list per owner (the `categories` table), matched
// case-insensitively. Every piece's category is on that list in the list's
// spelling: item writes add a missing category in the same D1 batch.

/** Every category with its piece count, sorted by name. */
export async function loadCategories(db: D1Database, owner: string): Promise<CategoryCount[]> {
  // Counts the pieces in one pass, then joins: joining pieces to categories
  // directly would read every piece once per category. The SQL order breaks
  // ties in the case-insensitive sort below ("Écharpes", "écharpes").
  const result = await db
    .prepare(
      `SELECT categories.name AS name, COALESCE(used.count, 0) AS count
       FROM categories
       LEFT JOIN (
         SELECT lower(category) AS name_key, COUNT(*) AS count
         FROM wardrobe_items WHERE owner = ?1
         GROUP BY name_key
       ) AS used ON used.name_key = lower(categories.name)
       WHERE categories.owner = ?1
       ORDER BY categories.name`,
    )
    .bind(owner)
    .all<CategoryCount>();
  return result.results.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * The category `value` names: the exact spelling first, since a name saved
 * before the API tidied names may differ from another category only by
 * spacing or by a non-ASCII letter's case; then the tidied value, matched
 * case-insensitively.
 */
export function findCategory(value: string, categories: CategoryCount[]) {
  const key = cleanText(value).toLowerCase();
  return (
    categories.find((category) => category.name === value) ??
    categories.find((category) => category.name.toLowerCase() === key)
  );
}

/** "shirts" becomes "Shirts": an existing category's spelling wins. */
export function canonicalCategory(value: string, categories: CategoryCount[]) {
  return findCategory(value, categories)?.name ?? value;
}

/**
 * SQL for the listed spelling of a category. Binds (owner, name); batch it
 * after addCategoryIfMissing so the category is there to find.
 */
export const LISTED_CATEGORY = "(SELECT name FROM categories WHERE owner = ? AND lower(name) = lower(?))";

/**
 * Adds `name` to the owner's categories unless one matches it
 * case-insensitively. `onlyIf` (an SQL condition, with its values) repeats
 * the condition of the write it is batched with, so a category is only
 * created when that write goes through.
 */
export function addCategoryIfMissing(
  db: D1Database,
  owner: string,
  name: string,
  onlyIf: string,
  onlyIfValues: (string | number)[],
) {
  return db
    .prepare(`INSERT OR IGNORE INTO categories (owner, name) SELECT ?, ? WHERE ${onlyIf}`)
    .bind(owner, name, ...onlyIfValues);
}

export function jsonError(status: number, error: string, code?: string) {
  return Response.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
}

export function apiError(error: unknown) {
  if (error instanceof WardrobeAuthError) {
    return jsonError(401, error.message, "unauthenticated");
  }
  if (error instanceof RequestError) {
    return jsonError(error.status, error.message, error.code);
  }
  if (error instanceof B2StorageError) {
    console.error(
      JSON.stringify({
        message: "B2 storage request failed",
        error: error.message,
        status: error.status,
      }),
    );
    return error.status === 503
      ? jsonError(503, "Photo storage is not set up yet. Please try again later.", "storage_unavailable")
      : jsonError(502, "Photo storage is temporarily unavailable. Please try again.", "storage_error");
  }
  if (error instanceof ImageProcessingError) {
    console.error(
      JSON.stringify({
        message: "Cloudflare image optimization failed",
        error: error.message,
        code: error.code,
      }),
    );
    if (error.code === 9422) {
      return jsonError(
        429,
        "The monthly free image-processing limit has been reached. Please try again next month.",
        "image_limit",
      );
    }
    if (error.code === 9412 || error.code === 9413) {
      return jsonError(
        400,
        "This photo could not be read. Please try a different JPG or PNG.",
        "unsupported_image",
      );
    }
    return jsonError(
      502,
      "This photo could not be processed. Please try again or use another photo.",
      "image_processing_failed",
    );
  }
  console.error(
    JSON.stringify({
      message: "wardrobe request failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return jsonError(500, "Something unexpected happened. Please try again.", "internal");
}
