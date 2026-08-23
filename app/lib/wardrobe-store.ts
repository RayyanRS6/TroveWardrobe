import { env } from "cloudflare:workers";
import { B2StorageError } from "./b2-storage";
import { ImageProcessingError } from "./image-processing";

export type WardrobeItemRow = {
  id: number;
  name: string;
  category: string;
  color: string;
  season: string;
  image_key: string;
};

export type OutfitRow = {
  id: number;
  name: string;
  occasion: string;
  item_ids: string;
};

export function getOwner(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email");

  if (!email?.trim()) throw new WardrobeAuthError();
  return email.trim().toLowerCase();
}

class WardrobeAuthError extends Error {
  constructor() {
    super("Please sign in to access your wardrobe.");
  }
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
    imageUrl: `/api/images/${row.id}?v=${encodeURIComponent(row.image_key)}`,
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
  };
}

export function apiError(error: unknown) {
  if (error instanceof WardrobeAuthError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof B2StorageError) {
    console.error(
      JSON.stringify({
        message: "B2 storage request failed",
        error: error.message,
        status: error.status,
      }),
    );
    return Response.json(
      { error: "Image storage is temporarily unavailable. Please try again." },
      { status: error.status === 503 ? 503 : 502 },
    );
  }
  if (error instanceof ImageProcessingError) {
    console.error(
      JSON.stringify({
        message: "Cloudflare image optimization failed",
        error: error.message,
        code: error.code,
      }),
    );
    const limitReached = error.code === 9422;
    return Response.json(
      {
        error: limitReached
          ? "The monthly free image-processing limit has been reached."
          : "This image could not be optimized. Please try another image.",
      },
      { status: limitReached ? 429 : 502 },
    );
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
