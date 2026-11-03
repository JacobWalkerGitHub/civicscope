ALTER TABLE `bill` ADD `source_checked_at` datetime(3);--> statement-breakpoint
-- Bills imported before this column existed were last fetched when their row was last
-- written. Keep updated_at as it was.
UPDATE `bill` SET `source_checked_at` = `updated_at`, `updated_at` = `updated_at`;
