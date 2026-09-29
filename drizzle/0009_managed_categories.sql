CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_owner_name_unique` ON `categories` (`owner`,lower("name"));--> statement-breakpoint
-- Categories become a managed list: the presets (PRESET_CATEGORIES) plus
-- every category a piece already uses. This migration only adds, so it can
-- run while the previous Worker (which still uses `season`) is live; 0010
-- drops `season` once the Worker that manages categories is live.
--
-- Pieces saved while the API only trimmed names take the spelling it saves
-- now: tabs, line breaks and no-break spaces become spaces, and runs of
-- spaces become one.
UPDATE `wardrobe_items` SET `category` = trim(
	replace(replace(replace(replace(replace(replace(
		replace(replace(replace(replace(replace(replace(`category`,
			char(9), ' '), char(10), ' '), char(11), ' '), char(12), ' '), char(13), ' '), char(160), ' '),
		'  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')
);--> statement-breakpoint
-- No category may be called "All" (the app's show-everything filter), or
-- "." or ".." (a URL cannot name them). Their pieces become Uncategorized.
UPDATE `wardrobe_items` SET `category` = 'Uncategorized'
WHERE `category` IN ('', '.', '..') OR lower(`category`) = 'all';--> statement-breakpoint
-- Among spellings that differ only by case, the preset wins, then the
-- most-used one (the earliest piece breaks ties), as the API grouped them
-- before.
INSERT OR IGNORE INTO `categories` (`owner`, `name`) VALUES
	('owner', 'Shirts'),
	('owner', 'T-shirts'),
	('owner', 'Pants'),
	('owner', 'Trousers'),
	('owner', 'Jeans'),
	('owner', 'Coats'),
	('owner', 'Jackets'),
	('owner', 'Pant coat'),
	('owner', 'Shalwar kameez'),
	('owner', 'Kurtas'),
	('owner', 'Sweaters'),
	('owner', 'Shoes'),
	('owner', 'Accessories');--> statement-breakpoint
INSERT OR IGNORE INTO `categories` (`owner`, `name`)
	SELECT `owner`, `category` FROM `wardrobe_items`
	GROUP BY `owner`, `category`
	ORDER BY COUNT(*) DESC, MIN(`id`);--> statement-breakpoint
-- Pieces take their category's spelling ("shirts" becomes "Shirts").
UPDATE `wardrobe_items` SET `category` = (
	SELECT `categories`.`name` FROM `categories`
	WHERE `categories`.`owner` = `wardrobe_items`.`owner`
		AND lower(`categories`.`name`) = lower(`wardrobe_items`.`category`)
)
WHERE `category` NOT IN (
	SELECT `categories`.`name` FROM `categories`
	WHERE `categories`.`owner` = `wardrobe_items`.`owner`
);
