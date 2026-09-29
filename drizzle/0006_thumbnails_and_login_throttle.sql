CREATE TABLE `auth_throttle` (
	`bucket` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `wardrobe_items` ADD `thumb_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wardrobe_items` ADD `thumb_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wardrobe_items` ADD `thumb_size` integer DEFAULT 0 NOT NULL;