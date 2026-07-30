CREATE TABLE `outfits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`occasion` text DEFAULT 'Everyday' NOT NULL,
	`item_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wardrobe_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`season` text DEFAULT 'All season' NOT NULL,
	`image_key` text NOT NULL,
	`image_type` text DEFAULT 'image/webp' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
