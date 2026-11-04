CREATE TABLE `result_area` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contest_id` int NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`precincts_total` int,
	`precincts_reporting` int,
	`votes` json NOT NULL,
	CONSTRAINT `result_area_id` PRIMARY KEY(`id`),
	CONSTRAINT `result_area_code_uq` UNIQUE(`contest_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `result_candidate` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contest_id` int NOT NULL,
	`key` varchar(191) NOT NULL,
	`name` varchar(200) NOT NULL,
	`party` varchar(60),
	`votes` int NOT NULL DEFAULT 0,
	CONSTRAINT `result_candidate_id` PRIMARY KEY(`id`),
	CONSTRAINT `result_candidate_key_uq` UNIQUE(`contest_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `result_contest` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feed_id` int NOT NULL,
	`source_key` varchar(191) NOT NULL,
	`name` varchar(300) NOT NULL,
	`group` enum('federal','statewide','legislature','judicial','measure','local') NOT NULL,
	`vote_for` smallint NOT NULL DEFAULT 1,
	`precincts_total` int,
	`precincts_reporting` int,
	`total_votes` int NOT NULL DEFAULT 0,
	`sort` int NOT NULL DEFAULT 0,
	CONSTRAINT `result_contest_id` PRIMARY KEY(`id`),
	CONSTRAINT `result_contest_source_uq` UNIQUE(`feed_id`,`source_key`)
);
--> statement-breakpoint
CREATE TABLE `result_feed` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state` char(2) NOT NULL,
	`election_date` date NOT NULL,
	`kind` varchar(20) NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`public_url` varchar(2048),
	`body_hash` char(64),
	`fetched_at` datetime(3),
	`changed_at` datetime(3),
	`error` varchar(1000),
	CONSTRAINT `result_feed_id` PRIMARY KEY(`id`),
	CONSTRAINT `result_feed_state_date_uq` UNIQUE(`state`,`election_date`)
);
--> statement-breakpoint
ALTER TABLE `ingest_run` MODIFY COLUMN `source` enum('fec','congress_legislators','congress_gov','state_results') NOT NULL;--> statement-breakpoint
ALTER TABLE `result_area` ADD CONSTRAINT `result_area_contest_id_result_contest_id_fk` FOREIGN KEY (`contest_id`) REFERENCES `result_contest`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `result_candidate` ADD CONSTRAINT `result_candidate_contest_id_result_contest_id_fk` FOREIGN KEY (`contest_id`) REFERENCES `result_contest`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `result_contest` ADD CONSTRAINT `result_contest_feed_id_result_feed_id_fk` FOREIGN KEY (`feed_id`) REFERENCES `result_feed`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `result_contest_group_idx` ON `result_contest` (`feed_id`,`group`,`sort`);