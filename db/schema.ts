import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

export const wardrobeCategories = sqliteTable(
  "wardrobe_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("wardrobe_categories_owner_idx").on(table.owner, table.name),
    uniqueIndex("wardrobe_categories_owner_name_unique").on(
      table.owner,
      table.name,
    ),
  ],
);
