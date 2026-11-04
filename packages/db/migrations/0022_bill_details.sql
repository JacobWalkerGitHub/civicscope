ALTER TABLE `bill` ADD `stage` enum('introduced','committee','reported','passed_house','passed_senate','passed_both','law','adopted','vetoed','failed');--> statement-breakpoint
ALTER TABLE `bill` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `bill` ADD `summary_version` varchar(200);--> statement-breakpoint
ALTER TABLE `bill` ADD `summary_date` date;--> statement-breakpoint
ALTER TABLE `bill` ADD `text_url` varchar(1000);--> statement-breakpoint
ALTER TABLE `bill` ADD `text_version` varchar(200);--> statement-breakpoint
ALTER TABLE `bill` ADD `text_date` date;--> statement-breakpoint
ALTER TABLE `bill` ADD `extras_checked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `congress_membership` ADD `member_name` varchar(200);--> statement-breakpoint
CREATE INDEX `bill_stage_idx` ON `bill` (`stage`,`latest_action_on`);--> statement-breakpoint
CREATE INDEX `bill_latest_action_idx` ON `bill` (`latest_action_on`);