// Wardrobe data held by the page: a reducer so every change is applied to
// the latest state (never to a stale copy), plus validation for data read
// from the API or from this device's offline copy.

import {
  PRESET_CATEGORIES,
  type CategoryCount,
  type Outfit,
  type WardrobeItem,
} from "../wardrobe-options";

export type WardrobeData = {
  items: WardrobeItem[];
  outfits: Outfit[];
  categories: CategoryCount[];
};

/** Where the shown data came from: nothing yet, this device, or the API. */
export type DataSource = "none" | "cache" | "server";

export type WardrobeState = {
  data: WardrobeData;
  source: DataSource;
  /** Bumped by every change confirmed by the API; saved to IndexedDB. */
  revision: number;
};

export type WardrobeAction =
  | { type: "cache-loaded"; data: WardrobeData }
  | { type: "synced"; data: WardrobeData }
  | { type: "item-saved"; item: WardrobeItem }
  | { type: "item-removed"; id: number }
  | { type: "outfit-saved"; outfit: Outfit }
  | { type: "outfit-removed"; id: number };

export const INITIAL_WARDROBE: WardrobeState = {
  data: { items: [], outfits: [], categories: [] },
  source: "none",
  revision: 0,
};

export const categoryKey = (name: string) => name.toLowerCase();

const presetByKey = new Map<string, string>(
  PRESET_CATEGORIES.map((preset) => [categoryKey(preset), preset]),
);

/**
 * Categories in use, grouped like GET /api/categories: case-insensitively,
 * named by the preset spelling or else the most-used one, sorted by name.
 */
export function deriveCategories(items: WardrobeItem[]): CategoryCount[] {
  const groups = new Map<string, Map<string, { count: number; firstId: number }>>();
  for (const item of items) {
    const key = categoryKey(item.category);
    const spellings = groups.get(key) ?? new Map();
    const spelling = spellings.get(item.category) ?? { count: 0, firstId: item.id };
    spelling.count += 1;
    spelling.firstId = Math.min(spelling.firstId, item.id);
    spellings.set(item.category, spelling);
    groups.set(key, spellings);
  }

  return [...groups.entries()]
    .map(([key, spellings]) => {
      let best = { name: "", count: 0, firstId: Infinity };
      let total = 0;
      for (const [name, spelling] of spellings) {
        total += spelling.count;
        if (
          spelling.count > best.count ||
          (spelling.count === best.count && spelling.firstId < best.firstId)
        ) {
          best = { name, ...spelling };
        }
      }
      return { name: presetByKey.get(key) ?? best.name, count: total };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

function withItems(data: WardrobeData, items: WardrobeItem[], outfits = data.outfits) {
  return { items, outfits, categories: deriveCategories(items) };
}

export function wardrobeReducer(state: WardrobeState, action: WardrobeAction): WardrobeState {
  const confirmed = (data: WardrobeData): WardrobeState => ({
    data,
    source: state.source === "none" ? "server" : state.source,
    revision: state.revision + 1,
  });

  switch (action.type) {
    case "cache-loaded":
      // The API answered first: its data wins.
      return state.source === "none" ? { ...state, data: action.data, source: "cache" } : state;
    case "synced":
      return { data: action.data, source: "server", revision: state.revision + 1 };
    case "item-saved": {
      const { items } = state.data;
      const exists = items.some((item) => item.id === action.item.id);
      const next = exists
        ? items.map((item) => (item.id === action.item.id ? action.item : item))
        : [action.item, ...items];
      return confirmed(withItems(state.data, next));
    }
    case "item-removed": {
      // The API also drops the piece from every outfit.
      const outfits = state.data.outfits.map((outfit) =>
        outfit.itemIds.includes(action.id)
          ? { ...outfit, itemIds: outfit.itemIds.filter((id) => id !== action.id) }
          : outfit,
      );
      const items = state.data.items.filter((item) => item.id !== action.id);
      return confirmed(withItems(state.data, items, outfits));
    }
    case "outfit-saved": {
      const { outfits } = state.data;
      const exists = outfits.some((outfit) => outfit.id === action.outfit.id);
      const next = exists
        ? outfits.map((outfit) => (outfit.id === action.outfit.id ? action.outfit : outfit))
        : [action.outfit, ...outfits];
      return confirmed({ ...state.data, outfits: next });
    }
    case "outfit-removed":
      return confirmed({
        ...state.data,
        outfits: state.data.outfits.filter((outfit) => outfit.id !== action.id),
      });
  }
}

// --- Validation -------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function toItem(value: unknown): WardrobeItem | null {
  if (!isRecord(value) || !isId(value.id) || typeof value.imageUrl !== "string") return null;
  return {
    id: value.id,
    name: text(value.name),
    category: text(value.category),
    color: text(value.color),
    season: text(value.season),
    imageUrl: value.imageUrl,
    // Copies saved before thumbnails existed fall back to the full photo.
    thumbUrl: text(value.thumbUrl) || value.imageUrl,
    createdAt: text(value.createdAt),
  };
}

export function toOutfit(value: unknown): Outfit | null {
  if (!isRecord(value) || !isId(value.id)) return null;
  return {
    id: value.id,
    name: text(value.name),
    occasion: text(value.occasion),
    itemIds: Array.isArray(value.itemIds) ? value.itemIds.filter(isId) : [],
    createdAt: text(value.createdAt),
  };
}

function toCategories(value: unknown): CategoryCount[] | null {
  if (!Array.isArray(value)) return null;
  const categories = value.filter(
    (entry): entry is CategoryCount =>
      isRecord(entry) && typeof entry.name === "string" && typeof entry.count === "number",
  );
  return categories.length === value.length ? categories : null;
}

function listOf<T>(value: unknown, convert: (entry: unknown) => T | null) {
  if (!Array.isArray(value)) return null;
  return value.map(convert).filter((entry): entry is T => entry !== null);
}

/** API responses → WardrobeData, or null when a response has the wrong shape. */
export function parseWardrobe(
  itemsBody: unknown,
  outfitsBody: unknown,
  categoriesBody: unknown,
): WardrobeData | null {
  const items = listOf(isRecord(itemsBody) ? itemsBody.items : null, toItem);
  const outfits = listOf(isRecord(outfitsBody) ? outfitsBody.outfits : null, toOutfit);
  if (!items || !outfits) return null;
  const categories =
    toCategories(isRecord(categoriesBody) ? categoriesBody.categories : null) ??
    deriveCategories(items);
  return { items, outfits, categories };
}

/** The IndexedDB copy → WardrobeData; older or damaged copies are repaired or ignored. */
export function parseSnapshot(value: unknown): WardrobeData | null {
  if (!isRecord(value)) return null;
  const items = listOf(value.items, toItem);
  const outfits = listOf(value.outfits, toOutfit);
  if (!items || !outfits) return null;
  // Older copies stored category names only; counts are rebuilt from items.
  return { items, outfits, categories: toCategories(value.categories) ?? deriveCategories(items) };
}

/** Every photo URL the current wardrobe uses (kept by the service worker). */
export function photoUrls(items: WardrobeItem[]) {
  return items.flatMap((item) => [item.imageUrl, item.thumbUrl]);
}
