ALTER TABLE `race` ADD `term_starts_on` date;--> statement-breakpoint
ALTER TABLE `race` ADD `term_start_source_url` varchar(2048);--> statement-breakpoint
ALTER TABLE `race` ADD CONSTRAINT `race_term_start_sourced` CHECK ((`race`.`term_starts_on` IS NULL) = (`race`.`term_start_source_url` IS NULL));