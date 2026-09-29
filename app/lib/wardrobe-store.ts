import { env } from "cloudflare:workers";
import {
  readAuthSecrets,
  readSessionToken,
  verifySessionToken,
} from "./auth";
import { B2StorageError } from "./b2-storage";
import { ImageProcessingError } from "./image-processing";
import { RequestError } from "./wardrobe-input";
import {
  PRESET_CATEGORIES,
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
  season: string;
  image_key: string;
  image_version: string;
  thumb_key: string;
  thumb_version: string;
  created_at: string;
};

export const ITEM_COLUMNS =
  "id, name, category, color, season, image_key, image_version, thumb_key, thumb_version, created_at";

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
    season: row.season,
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

const categoryKey = (value: string) => value.toLowerCase();
const presetByKey = new Map<string, string>(
  PRESET_CATEGORIES.map((preset) => [categoryKey(preset), preset]),
);

/**
 * Item categories grouped case-insensitively and sorted by name. A group is
 * named by its preset spelling, else by its most-used spelling.
 */
export async function loadCategoryCounts(
  db: D1Database,
  owner: string,
  excludeItemId?: number,
): Promise<CategoryCount[]> {
  const result = await db
    .prepare(
      `SELECT category, COUNT(*) AS count, MIN(id) AS first_id
       FROM wardrobe_items
       WHERE owner = ? AND id <> ?
       GROUP BY category`,
    )
    .bind(owner, excludeItemId ?? 0)
    .all<{ category: string; count: number; first_id: number }>();

  const groups = new Map<string, { name: string; count: number; best: number; firstId: number }>();
  for (const row of result.results) {
    const key = categoryKey(row.category);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { name: row.category, count: row.count, best: row.count, firstId: row.first_id });
      continue;
    }
    group.count += row.count;
    if (row.count > group.best || (row.count === group.best && row.first_id < group.firstId)) {
      Object.assign(group, { name: row.category, best: row.count, firstId: row.first_id });
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => ({ name: presetByKey.get(key) ?? group.name, count: group.count }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** "shirts" becomes "Shirts": a preset or existing category's spelling wins. */
export function canonicalCategory(value: string, existing: CategoryCount[]) {
  const key = categoryKey(value);
  return (
    presetByKey.get(key) ??
    existing.find((category) => categoryKey(category.name) === key)?.name ??
    value
  );
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
