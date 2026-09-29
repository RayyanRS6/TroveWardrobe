-- Apply only once the Worker that manages categories is live: the Worker
-- before it still reads and writes `season`.
--
-- That previous Worker may have saved pieces after 0009 ran, in a category
-- that is not listed yet or in another spelling of one. List and respell
-- them as 0009 did. It already tidied whitespace and refused "All", but not
-- "." or "..".
UPDATE `wardrobe_items` SET `category` = 'Uncategorized' WHERE `category` IN ('.', '..');--> statement-breakpoint
INSERT OR IGNORE INTO `categories` (`owner`, `name`)
	SELECT `owner`, `category` FROM `wardrobe_items`
	GROUP BY `owner`, `category`
	ORDER BY COUNT(*) DESC, MIN(`id`);--> statement-breakpoint
UPDATE `wardrobe_items` SET `category` = (
	SELECT `categories`.`name` FROM `categories`
	WHERE `categories`.`owner` = `wardrobe_items`.`owner`
		AND lower(`categories`.`name`) = lower(`wardrobe_items`.`category`)
)
WHERE `category` NOT IN (
	SELECT `categories`.`name` FROM `categories`
	WHERE `categories`.`owner` = `wardrobe_items`.`owner`
);--> statement-breakpoint
-- Seasons are gone from the app.
ALTER TABLE `wardrobe_items` DROP COLUMN `season`;
