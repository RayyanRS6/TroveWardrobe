// Shared wardrobe vocabulary, limits and API shapes. Imported by both the
// browser UI and the API routes, so it must stay free of server imports.

export const PRESET_CATEGORIES = [
  "Shirts",
  "T-shirts",
  "Pants",
  "Trousers",
  "Jeans",
  "Coats",
  "Jackets",
  "Pant coat",
  "Shalwar kameez",
  "Kurtas",
  "Sweaters",
  "Shoes",
  "Accessories",
] as const;

/** The UI's "show everything" filter; no category may use this name. */
export const RESERVED_CATEGORY = "All";

export const SEASONS = ["All season", "Summer", "Winter", "Spring", "Autumn"] as const;
export const DEFAULT_SEASON = "All season";

export const OCCASIONS = ["Everyday", "Work", "Formal", "Casual", "Festive", "Travel"] as const;
export const DEFAULT_OCCASION = "Everyday";

export const NAME_MAX = 60;
export const CATEGORY_MAX = 40;
export const COLOR_MAX = 30;
export const OUTFIT_ITEMS_MAX = 20;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Photo types the items API accepts (checked by file signature, not by
 * name). GIFs keep their first frame. AVIF input needs a Cloudflare Images
 * Enterprise plan, so it is rejected with a clear message.
 */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
] as const;

/** Value for an `<input type="file" accept>` attribute. */
export const IMAGE_ACCEPT = [...ACCEPTED_IMAGE_TYPES, ".heic", ".heif"].join(",");

export type Season = (typeof SEASONS)[number];
export type Occasion = (typeof OCCASIONS)[number];

/** GET/POST/PATCH /api/items */
export type WardrobeItem = {
  id: number;
  name: string;
  category: string;
  color: string;
  /** One of SEASONS. */
  season: string;
  /** Display photo (WebP, up to 1600 px wide). */
  imageUrl: string;
  /** Grid thumbnail (WebP, up to 480 px wide). */
  thumbUrl: string;
  /** ISO 8601 UTC, e.g. "2026-09-29T10:15:00Z". */
  createdAt: string;
};

/** GET/POST/PATCH /api/outfits */
export type Outfit = {
  id: number;
  name: string;
  /** One of OCCASIONS. */
  occasion: string;
  itemIds: number[];
  createdAt: string;
};

/** GET /api/categories */
export type CategoryCount = {
  name: string;
  count: number;
};

/** GET /api/usage */
export type StorageUsage = {
  bytesUsed: number;
  limitBytes: number;
};

/** Every API error body. */
export type ApiErrorBody = {
  error: string;
  code?: string;
};
