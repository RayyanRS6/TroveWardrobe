CREATE TABLE `wardrobe_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wardrobe_categories_owner_idx` ON `wardrobe_categories` (`owner`,`name`);