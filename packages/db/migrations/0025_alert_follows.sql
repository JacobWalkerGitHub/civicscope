CREATE TABLE `alert_follow` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`kind` enum('member','bill') NOT NULL,
	`target_key` varchar(40) NOT NULL,
	`target_label` varchar(300) NOT NULL,
	`requested_at` datetime(3) NOT NULL,
	`request_ip` varchar(45),
	`confirmed_at` datetime(3),
	`last_sent_at` datetime(3),
	`seen_vote_id` int NOT NULL DEFAULT 0,
	`seen_sponsorship_id` int NOT NULL DEFAULT 0,
	`seen_action` char(51),
	`seen_filing_end` date,
	CONSTRAINT `alert_follow_id` PRIMARY KEY(`id`),
	CONSTRAINT `alert_follow_uq` UNIQUE(`email`,`kind`,`target_key`)
);
--> statement-breakpoint
CREATE INDEX `alert_follow_confirmed_idx` ON `alert_follow` (`confirmed_at`);--> statement-breakpoint
CREATE INDEX `alert_follow_requested_idx` ON `alert_follow` (`requested_at`);