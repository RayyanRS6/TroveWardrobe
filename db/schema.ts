import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const wardrobeItems = sqliteTable(
  "wardrobe_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    // A managed category's name, in that category's spelling.
    category: text("category").notNull(),
    color: text("color").notNull().default(""),
    imageKey: text("image_key").notNull(),
    imageVersion: text("image_version").notNull().default(""),
    imageType: text("image_type").notNull().default("image/webp"),
    imageSize: integer("image_size").notNull().default(0),
    // Small WebP rendition for grids. Empty on rows saved before thumbnails.
    thumbKey: text("thumb_key").notNull().default(""),
    thumbVersion: text("thumb_version").notNull().default(""),
    thumbSize: integer("thumb_size").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("wardrobe_items_owner_idx").on(table.owner, table.createdAt),
  ],
);

// The owner's category list, including categories with no pieces yet.
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // One spelling per name: SQLite's lower() folds ASCII letters, so
    // "shirts" and "Shirts" collide.
    uniqueIndex("categories_owner_name_unique").on(table.owner, sql`lower(${table.name})`),
  ],
);

export const outfits = sqliteTable(
  "outfits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    occasion: text("occasion").notNull().default("Everyday"),
    itemIds: text("item_ids").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("outfits_owner_idx").on(table.owner, table.createdAt)],
);

// Failed sign-ins per client network ("ip:<address>" or "ip:<ipv6 /64>").
// Times are Unix seconds.
export const authThrottle = sqliteTable("auth_throttle", {
  bucket: text("bucket").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStart: integer("window_start").notNull(),
  lockedUntil: integer("locked_until").notNull().default(0),
});
