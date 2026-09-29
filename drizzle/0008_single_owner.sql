-- Trove has one app password and one owner. Rows written while Cloudflare
-- Access identified users by email move to the constant owner id.
UPDATE `wardrobe_items` SET `owner` = 'owner' WHERE `owner` <> 'owner';--> statement-breakpoint
UPDATE `outfits` SET `owner` = 'owner' WHERE `owner` <> 'owner';
