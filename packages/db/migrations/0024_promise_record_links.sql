CREATE TABLE `promise_record_link` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claim_id` int NOT NULL,
	`record_type` enum('bill','vote','state_vote') NOT NULL,
	`record_id` int NOT NULL,
	`note` varchar(500) NOT NULL,
	`created_by` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `promise_record_link_id` PRIMARY KEY(`id`),
	CONSTRAINT `promise_record_link_uq` UNIQUE(`claim_id`,`record_type`,`record_id`)
);
--> statement-breakpoint
ALTER TABLE `promise_record_link` ADD CONSTRAINT `promise_record_link_claim_id_claim_id_fk` FOREIGN KEY (`claim_id`) REFERENCES `claim`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `promise_record_link_record_idx` ON `promise_record_link` (`record_type`,`record_id`);