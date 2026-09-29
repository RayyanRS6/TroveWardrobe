import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const wardrobeItems = sqliteTable(
  "wardrobe_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    color: text("color").notNull().default(""),
    season: text("season").notNull().default("All season"),
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
