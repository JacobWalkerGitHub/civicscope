CREATE TABLE `state_bill` (
	`id` int AUTO_INCREMENT NOT NULL,
	`os_id` varchar(80) NOT NULL,
	`state` char(2) NOT NULL,
	`session` varchar(40) NOT NULL,
	`identifier` varchar(40) NOT NULL,
	`title` varchar(2000) NOT NULL,
	`latest_action_on` date,
	`latest_action_text` varchar(1000),
	`openstates_url` varchar(500),
	`source_updated_at` varchar(40) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `state_bill_id` PRIMARY KEY(`id`),
	CONSTRAINT `state_bill_os_uq` UNIQUE(`os_id`)
);
--> statement-breakpoint
CREATE TABLE `state_vote` (
	`id` int AUTO_INCREMENT NOT NULL,
	`os_id` varchar(80) NOT NULL,
	`bill_id` int NOT NULL,
	`chamber` enum('upper','lower','legislature') NOT NULL,
	`motion` varchar(500) NOT NULL,
	`voted_on` date NOT NULL,
	`result` varchar(40) NOT NULL,
	`yes` smallint NOT NULL DEFAULT 0,
	`no` smallint NOT NULL DEFAULT 0,
	`other` smallint NOT NULL DEFAULT 0,
	`source_url` varchar(1000),
	CONSTRAINT `state_vote_id` PRIMARY KEY(`id`),
	CONSTRAINT `state_vote_os_uq` UNIQUE(`os_id`)
);
--> statement-breakpoint
CREATE TABLE `state_vote_cursor` (
	`state` char(2) NOT NULL,
	`updated_since` varchar(40) NOT NULL,
	`page` int NOT NULL DEFAULT 1,
	CONSTRAINT `state_vote_cursor_state` PRIMARY KEY(`state`)
);
--> statement-breakpoint
CREATE TABLE `state_vote_position` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vote_id` int NOT NULL,
	`os_person_id` varchar(80),
	`voter_name` varchar(200) NOT NULL,
	`option` varchar(40) NOT NULL,
	CONSTRAINT `state_vote_position_id` PRIMARY KEY(`id`),
	CONSTRAINT `state_vote_position_uq` UNIQUE(`vote_id`,`voter_name`)
);
--> statement-breakpoint
ALTER TABLE `ingest_run` MODIFY COLUMN `source` enum('fec','congress_legislators','congress_gov','state_results','openstates') NOT NULL;--> statement-breakpoint
ALTER TABLE `state_vote` ADD CONSTRAINT `state_vote_bill_id_state_bill_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `state_bill`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `state_vote_position` ADD CONSTRAINT `state_vote_position_vote_id_state_vote_id_fk` FOREIGN KEY (`vote_id`) REFERENCES `state_vote`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `state_bill_state_idx` ON `state_bill` (`state`,`session`);--> statement-breakpoint
CREATE INDEX `state_vote_bill_idx` ON `state_vote` (`bill_id`);--> statement-breakpoint
CREATE INDEX `state_vote_position_person_idx` ON `state_vote_position` (`os_person_id`);