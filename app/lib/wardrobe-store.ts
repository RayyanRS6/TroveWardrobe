import { env } from "cloudflare:workers";

type WardrobeEnv = {
  DB?: D1Database;
  WARDROBE_IMAGES?: R2Bucket;
};

export type WardrobeItemRow = {
  id: number;
  owner: string;
  name: string;
  category: string;
  color: string;
  season: string;
  image_key: string;
  image_type: string;
  created_at: string;
};

export type OutfitRow = {
  id: number;
  owner: string;
  name: string;
  occasion: string;
  item_ids: string;
  created_at: string;
};

function runtimeEnv() {
  return env as unknown as WardrobeEnv;
}

export function getOwner(request: Request) {
  return (
    request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ||
    "local@trove.app"
  );
}

export function getImageBucket() {
  const bucket = runtimeEnv().WARDROBE_IMAGES;
  if (!bucket) {
    throw new Error("Wardrobe image storage is not available.");
  }
  return bucket;
}

export async function getWardrobeDb() {
  const db = runtimeEnv().DB;
  if (!db) {
    throw new Error("Wardrobe database is not available.");
  }

  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wardrobe_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        season TEXT NOT NULL DEFAULT 'All season',
        image_key TEXT NOT NULL,
        image_type TEXT NOT NULL DEFAULT 'image/webp',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS outfits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        occasion TEXT NOT NULL DEFAULT 'Everyday',
        item_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS wardrobe_items_owner_idx ON wardrobe_items (owner, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS outfits_owner_idx ON outfits (owner, created_at)",
    ),
  ]);

  return db;
}

export function itemResponse(row: WardrobeItemRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    season: row.season,
    imageUrl: `/api/images/${row.id}`,
    createdAt: row.created_at,
  };
}

export function outfitResponse(row: OutfitRow) {
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
    createdAt: row.created_at,
  };
}

export function apiError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Something unexpected happened.";
  console.error(error);
  return Response.json({ error: message }, { status: 500 });
}
