import { env } from "cloudflare:workers";

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

export function getOwner(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email");

  if (!email?.trim()) throw new WardrobeAuthError();
  return email.trim().toLowerCase();
}

export class WardrobeAuthError extends Error {
  constructor() {
    super("Please sign in to access your wardrobe.");
  }
}

export function getImageBucket() {
  return env.WARDROBE_IMAGES;
}

export function getWardrobeDb() {
  return env.DB;
}

export function itemResponse(row: WardrobeItemRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    season: row.season,
    imageUrl: `/api/images/${row.id}?w=640`,
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
  if (error instanceof WardrobeAuthError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  console.error(
    JSON.stringify({
      message: "wardrobe request failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return Response.json(
    { error: "Something unexpected happened. Please try again." },
    { status: 500 },
  );
}
