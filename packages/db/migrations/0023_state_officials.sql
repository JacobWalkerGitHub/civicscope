CREATE TABLE `state_officeholder` (
	`id` int AUTO_INCREMENT NOT NULL,
	`os_person_id` varchar(80) NOT NULL,
	`state` char(2) NOT NULL,
	`role` enum('governor','upper','lower','legislature') NOT NULL,
	`district` varchar(60),
	`name` varchar(200) NOT NULL,
	`sort_name` varchar(200) NOT NULL,
	`party_name` varchar(100),
	`official_url` varchar(500),
	`term_start` date,
	`term_end` date,
	`source_id` int NOT NULL,
	`first_seen_on` date NOT NULL,
	`last_seen_on` date NOT NULL,
	`left_on` date,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `state_officeholder_id` PRIMARY KEY(`id`),
	CONSTRAINT `state_officeholder_uq` UNIQUE(`os_person_id`,`state`,`role`)
);
--> statement-breakpoint
ALTER TABLE `ingest_run` MODIFY COLUMN `source` enum('fec','congress_legislators','congress_gov','state_results','openstates','fec_totals','state_officials') NOT NULL;--> statement-breakpoint
ALTER TABLE `state_officeholder` ADD CONSTRAINT `state_officeholder_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `state_officeholder_seat_idx` ON `state_officeholder` (`state`,`role`,`left_on`);