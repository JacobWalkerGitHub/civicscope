CREATE TABLE `result_update` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feed_id` int NOT NULL,
	`contest_id` int NOT NULL,
	`kind` enum('first_votes','milestone','lead_change','all_in') NOT NULL,
	`text` varchar(500) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `result_update_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `result_update` ADD CONSTRAINT `result_update_feed_id_result_feed_id_fk` FOREIGN KEY (`feed_id`) REFERENCES `result_feed`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `result_update_feed_idx` ON `result_update` (`feed_id`,`created_at`);