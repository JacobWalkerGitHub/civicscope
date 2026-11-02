CREATE TABLE `district` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` int NOT NULL,
	`type` enum('congressional','state_upper','state_lower','at_large','other') NOT NULL,
	`label` varchar(50) NOT NULL,
	`name` varchar(200) NOT NULL,
	`ocd_id` varchar(255) NOT NULL,
	`plan_name` varchar(200),
	`valid_from` date NOT NULL,
	`valid_to` date,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `district_id` PRIMARY KEY(`id`),
	CONSTRAINT `district_ocd_valid_from_uq` UNIQUE(`ocd_id`,`valid_from`),
	CONSTRAINT `district_valid_range` CHECK(`district`.`valid_to` IS NULL OR `district`.`valid_to` > `district`.`valid_from`)
);
--> statement-breakpoint
CREATE TABLE `jurisdiction` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int,
	`type` enum('country','state','federal_district','territory','county','municipality','township','school_district','special_district','other') NOT NULL,
	`name` varchar(200) NOT NULL,
	`usps_code` char(2),
	`fips` varchar(5),
	`ansi_code` varchar(8),
	`ocd_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `jurisdiction_id` PRIMARY KEY(`id`),
	CONSTRAINT `jurisdiction_ocd_id_uq` UNIQUE(`ocd_id`),
	CONSTRAINT `jurisdiction_usps_code_uq` UNIQUE(`usps_code`),
	CONSTRAINT `jurisdiction_root_is_country` CHECK((`jurisdiction`.`type` = 'country') = (`jurisdiction`.`parent_id` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `office` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` int NOT NULL,
	`slug` varchar(200) NOT NULL,
	`title` varchar(200) NOT NULL,
	`level` enum('federal','state','local') NOT NULL,
	`branch` enum('executive','legislative','judicial','other') NOT NULL,
	`chamber` enum('upper','lower','unicameral'),
	`seats` int NOT NULL DEFAULT 1,
	`term_years` tinyint,
	`is_partisan` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `office_id` PRIMARY KEY(`id`),
	CONSTRAINT `office_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `office_seats_positive` CHECK(`office`.`seats` >= 1),
	CONSTRAINT `office_term_years_range` CHECK(`office`.`term_years` IS NULL OR `office`.`term_years` BETWEEN 1 AND 20),
	CONSTRAINT `office_chamber_only_for_legislative` CHECK(`office`.`chamber` IS NULL OR `office`.`branch` = 'legislative')
);
--> statement-breakpoint
CREATE TABLE `party` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(100) NOT NULL,
	`name` varchar(200) NOT NULL,
	`short_name` varchar(50),
	`fec_code` char(3),
	`jurisdiction_id` int,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `party_id` PRIMARY KEY(`id`),
	CONSTRAINT `party_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `election` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cycle_id` int NOT NULL,
	`jurisdiction_id` int NOT NULL,
	`type` enum('primary','primary_runoff','special_primary','convention','general','general_runoff','special_general','special_runoff') NOT NULL,
	`primary_system` enum('closed','semi_closed','open_partisan','top_two','jungle','nonpartisan','not_applicable') NOT NULL,
	`date` date NOT NULL,
	`name` varchar(200) NOT NULL,
	`official_url` varchar(2048),
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `election_id` PRIMARY KEY(`id`),
	CONSTRAINT `election_id_type_system_uq` UNIQUE(`id`,`type`,`primary_system`),
	CONSTRAINT `election_jurisdiction_type_date_uq` UNIQUE(`jurisdiction_id`,`type`,`date`),
	CONSTRAINT `election_primary_system_matches_type` CHECK((`election`.`type` IN ('general', 'general_runoff', 'special_general', 'special_runoff')) = (`election`.`primary_system` = 'not_applicable'))
);
--> statement-breakpoint
CREATE TABLE `election_cycle` (
	`id` int AUTO_INCREMENT NOT NULL,
	`year` smallint NOT NULL,
	`label` varchar(100) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `election_cycle_id` PRIMARY KEY(`id`),
	CONSTRAINT `election_cycle_year_uq` UNIQUE(`year`),
	CONSTRAINT `election_cycle_year_range` CHECK(`election_cycle`.`year` BETWEEN 1789 AND 2200)
);
--> statement-breakpoint
CREATE TABLE `election_deadline` (
	`id` int AUTO_INCREMENT NOT NULL,
	`election_id` int NOT NULL,
	`kind` enum('filing_open','filing_close','petition','withdrawal','voter_registration','mail_ballot_request','early_voting_start','early_voting_end','certification','other') NOT NULL,
	`date` date NOT NULL,
	`label` varchar(200) NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `election_deadline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `official_resource` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` int NOT NULL,
	`kind` enum('election_authority','candidate_list','results','voter_registration','polling_place','campaign_finance','other') NOT NULL,
	`label` varchar(200) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`last_checked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `official_resource_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `race` (
	`id` int AUTO_INCREMENT NOT NULL,
	`election_id` int NOT NULL,
	`election_type` enum('primary','primary_runoff','special_primary','convention','general','general_runoff','special_general','special_runoff') NOT NULL,
	`primary_system` enum('closed','semi_closed','open_partisan','top_two','jungle','nonpartisan','not_applicable') NOT NULL,
	`office_id` int NOT NULL,
	`district_id` int,
	`party_id` int,
	`name` varchar(200) NOT NULL,
	`seats` int NOT NULL DEFAULT 1,
	`is_special` boolean NOT NULL DEFAULT false,
	`status` enum('scheduled','uncontested','cancelled','certified') NOT NULL DEFAULT 'scheduled',
	`contest_key` varchar(80) GENERATED ALWAYS AS (concat_ws('-', election_id, office_id, ifnull(district_id, 0), ifnull(party_id, 0), is_special)) STORED NOT NULL,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `race_id` PRIMARY KEY(`id`),
	CONSTRAINT `race_contest_uq` UNIQUE(`contest_key`),
	CONSTRAINT `race_seats_positive` CHECK(`race`.`seats` >= 1),
	CONSTRAINT `race_party_rule` CHECK((`race`.`party_id` IS NOT NULL) = (`race`.`election_type` IN ('primary', 'primary_runoff', 'special_primary', 'convention') AND `race`.`primary_system` IN ('closed', 'semi_closed', 'open_partisan')))
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`actor_type` enum('user','job','system') NOT NULL,
	`actor_id` varchar(100) NOT NULL,
	`action` enum('create','update','publish','unpublish','archive','restore','merge','split','import','delete') NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`diff` json,
	`note` varchar(1000),
	`ip_address` varchar(45),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `district` ADD CONSTRAINT `district_jurisdiction_id_jurisdiction_id_fk` FOREIGN KEY (`jurisdiction_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jurisdiction` ADD CONSTRAINT `jurisdiction_parent_id_jurisdiction_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `office` ADD CONSTRAINT `office_jurisdiction_id_jurisdiction_id_fk` FOREIGN KEY (`jurisdiction_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `party` ADD CONSTRAINT `party_jurisdiction_id_jurisdiction_id_fk` FOREIGN KEY (`jurisdiction_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `election` ADD CONSTRAINT `election_cycle_id_election_cycle_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `election_cycle`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `election` ADD CONSTRAINT `election_jurisdiction_id_jurisdiction_id_fk` FOREIGN KEY (`jurisdiction_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `election_deadline` ADD CONSTRAINT `election_deadline_election_id_election_id_fk` FOREIGN KEY (`election_id`) REFERENCES `election`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `official_resource` ADD CONSTRAINT `official_resource_jurisdiction_id_jurisdiction_id_fk` FOREIGN KEY (`jurisdiction_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `race` ADD CONSTRAINT `race_office_id_office_id_fk` FOREIGN KEY (`office_id`) REFERENCES `office`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `race` ADD CONSTRAINT `race_district_id_district_id_fk` FOREIGN KEY (`district_id`) REFERENCES `district`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `race` ADD CONSTRAINT `race_party_id_party_id_fk` FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `race` ADD CONSTRAINT `race_election_fk` FOREIGN KEY (`election_id`,`election_type`,`primary_system`) REFERENCES `election`(`id`,`type`,`primary_system`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `district_jurisdiction_type_idx` ON `district` (`jurisdiction_id`,`type`);--> statement-breakpoint
CREATE INDEX `jurisdiction_parent_idx` ON `jurisdiction` (`parent_id`);--> statement-breakpoint
CREATE INDEX `office_jurisdiction_idx` ON `office` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `party_fec_code_idx` ON `party` (`fec_code`);--> statement-breakpoint
CREATE INDEX `election_cycle_idx` ON `election` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `election_date_idx` ON `election` (`date`);--> statement-breakpoint
CREATE INDEX `election_deadline_election_idx` ON `election_deadline` (`election_id`,`date`);--> statement-breakpoint
CREATE INDEX `official_resource_jurisdiction_idx` ON `official_resource` (`jurisdiction_id`,`kind`);--> statement-breakpoint
CREATE INDEX `race_election_idx` ON `race` (`election_id`);--> statement-breakpoint
CREATE INDEX `race_office_idx` ON `race` (`office_id`);--> statement-breakpoint
CREATE INDEX `race_district_idx` ON `race` (`district_id`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_type`,`actor_id`,`occurred_at`);