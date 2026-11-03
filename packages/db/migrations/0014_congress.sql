CREATE TABLE `bill` (
	`id` int AUTO_INCREMENT NOT NULL,
	`congress` smallint NOT NULL,
	`bill_type` enum('hr','s','hjres','sjres','hconres','sconres','hres','sres') NOT NULL,
	`number` int NOT NULL,
	`title` varchar(2000) NOT NULL,
	`introduced_on` date,
	`policy_area` varchar(200),
	`latest_action_on` date,
	`latest_action_text` varchar(2000),
	`source_id` int NOT NULL,
	`source_updated_at` varchar(40) NOT NULL,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `bill_id` PRIMARY KEY(`id`),
	CONSTRAINT `bill_uq` UNIQUE(`congress`,`bill_type`,`number`)
);
--> statement-breakpoint
CREATE TABLE `bill_sponsorship` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bill_id` int NOT NULL,
	`bioguide_id` char(7) NOT NULL,
	`role` enum('sponsor','cosponsor') NOT NULL,
	`is_original` boolean NOT NULL DEFAULT false,
	`sponsored_on` date,
	`withdrawn_on` date,
	`party` varchar(10),
	`state` char(2),
	CONSTRAINT `bill_sponsorship_id` PRIMARY KEY(`id`),
	CONSTRAINT `bill_sponsorship_uq` UNIQUE(`bill_id`,`bioguide_id`)
);
--> statement-breakpoint
CREATE TABLE `congress_membership` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bioguide_id` char(7) NOT NULL,
	`congress` smallint NOT NULL,
	`chamber` enum('house','senate') NOT NULL,
	`state` char(2) NOT NULL,
	`district` smallint,
	`party_name` varchar(100),
	`start_year` smallint NOT NULL,
	`end_year` smallint,
	`source_id` int NOT NULL,
	`source_updated_at` varchar(40) NOT NULL,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `congress_membership_id` PRIMARY KEY(`id`),
	CONSTRAINT `congress_membership_uq` UNIQUE(`bioguide_id`,`congress`,`chamber`)
);
--> statement-breakpoint
CREATE TABLE `roll_call_vote` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chamber` enum('house','senate') NOT NULL,
	`congress` smallint NOT NULL,
	`session` smallint NOT NULL,
	`roll_number` int NOT NULL,
	`voted_at` datetime NOT NULL,
	`question` varchar(500),
	`vote_type` varchar(100),
	`result` varchar(100),
	`legislation_type` varchar(20),
	`legislation_number` varchar(20),
	`source_id` int NOT NULL,
	`source_updated_at` varchar(40) NOT NULL,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `roll_call_vote_id` PRIMARY KEY(`id`),
	CONSTRAINT `roll_call_vote_uq` UNIQUE(`chamber`,`congress`,`session`,`roll_number`)
);
--> statement-breakpoint
CREATE TABLE `vote_position` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`vote_id` int NOT NULL,
	`bioguide_id` char(7) NOT NULL,
	`vote_cast` varchar(100) NOT NULL,
	`party` varchar(10),
	`state` char(2),
	CONSTRAINT `vote_position_id` PRIMARY KEY(`id`),
	CONSTRAINT `vote_position_uq` UNIQUE(`vote_id`,`bioguide_id`)
);
--> statement-breakpoint
ALTER TABLE `ingest_run` MODIFY COLUMN `source` enum('fec','congress_legislators','congress_gov') NOT NULL;--> statement-breakpoint
ALTER TABLE `bill` ADD CONSTRAINT `bill_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_sponsorship` ADD CONSTRAINT `bill_sponsorship_bill_id_bill_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bill`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `congress_membership` ADD CONSTRAINT `congress_membership_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roll_call_vote` ADD CONSTRAINT `roll_call_vote_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vote_position` ADD CONSTRAINT `vote_position_vote_id_roll_call_vote_id_fk` FOREIGN KEY (`vote_id`) REFERENCES `roll_call_vote`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bill_sponsorship_member_idx` ON `bill_sponsorship` (`bioguide_id`,`role`);--> statement-breakpoint
CREATE INDEX `congress_membership_seat_idx` ON `congress_membership` (`congress`,`chamber`,`state`);--> statement-breakpoint
CREATE INDEX `roll_call_vote_date_idx` ON `roll_call_vote` (`voted_at`);--> statement-breakpoint
CREATE INDEX `vote_position_member_idx` ON `vote_position` (`bioguide_id`);