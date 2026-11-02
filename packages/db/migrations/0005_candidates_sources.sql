CREATE TABLE `citation` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_id` int NOT NULL,
	`subject_type` enum('person','candidacy') NOT NULL,
	`subject_id` int NOT NULL,
	`field` varchar(64),
	`excerpt` varchar(2000),
	`locator` varchar(200),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `citation_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `source` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` varchar(2048) NOT NULL,
	`url_hash` char(64) GENERATED ALWAYS AS (sha2(url, 256)) STORED NOT NULL,
	`title` varchar(500) NOT NULL,
	`publisher` varchar(200) NOT NULL,
	`source_type` enum('official_election_authority','government_record','legislative_record','court_record','news','campaign_site','reference','other') NOT NULL,
	`published_at` date,
	`retrieved_at` date NOT NULL,
	`archive_url` varchar(2048),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `source_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_url_hash_uq` UNIQUE(`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `candidacy` (
	`id` int AUTO_INCREMENT NOT NULL,
	`person_id` int NOT NULL,
	`race_id` int NOT NULL,
	`party_id` int,
	`ballot_name` varchar(200) NOT NULL,
	`is_incumbent` boolean NOT NULL DEFAULT false,
	`status` enum('announced','filed','qualified','withdrawn','disqualified','advanced','won','lost'),
	`status_date` date,
	`campaign_url` varchar(2048),
	`fec_committee_id` char(9),
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `candidacy_id` PRIMARY KEY(`id`),
	CONSTRAINT `candidacy_person_race_uq` UNIQUE(`person_id`,`race_id`)
);
--> statement-breakpoint
CREATE TABLE `candidacy_status_event` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`candidacy_id` int NOT NULL,
	`status` enum('announced','filed','qualified','withdrawn','disqualified','advanced','won','lost') NOT NULL,
	`effective_date` date NOT NULL,
	`source_id` int NOT NULL,
	`note` varchar(500),
	`recorded_by` varchar(100) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `candidacy_status_event_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `person` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(200) NOT NULL,
	`full_name` varchar(200) NOT NULL,
	`preferred_name` varchar(100),
	`sort_name` varchar(200) NOT NULL,
	`birth_year` smallint,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `person_id` PRIMARY KEY(`id`),
	CONSTRAINT `person_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `person_birth_year_range` CHECK(`person`.`birth_year` IS NULL OR `person`.`birth_year` >= 1900)
);
--> statement-breakpoint
CREATE TABLE `person_identifier` (
	`id` int AUTO_INCREMENT NOT NULL,
	`person_id` int NOT NULL,
	`scheme` enum('fec_candidate_id','bioguide','openstates','state_filing','ballotpedia','wikidata') NOT NULL,
	`value` varchar(100) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `person_identifier_id` PRIMARY KEY(`id`),
	CONSTRAINT `person_identifier_scheme_value_uq` UNIQUE(`scheme`,`value`)
);
--> statement-breakpoint
ALTER TABLE `citation` ADD CONSTRAINT `citation_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidacy` ADD CONSTRAINT `candidacy_person_id_person_id_fk` FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidacy` ADD CONSTRAINT `candidacy_race_id_race_id_fk` FOREIGN KEY (`race_id`) REFERENCES `race`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidacy` ADD CONSTRAINT `candidacy_party_id_party_id_fk` FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidacy_status_event` ADD CONSTRAINT `candidacy_status_event_candidacy_id_candidacy_id_fk` FOREIGN KEY (`candidacy_id`) REFERENCES `candidacy`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidacy_status_event` ADD CONSTRAINT `candidacy_status_event_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_identifier` ADD CONSTRAINT `person_identifier_person_id_person_id_fk` FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `citation_subject_idx` ON `citation` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `citation_source_idx` ON `citation` (`source_id`);--> statement-breakpoint
CREATE INDEX `source_publisher_idx` ON `source` (`publisher`);--> statement-breakpoint
CREATE INDEX `candidacy_race_idx` ON `candidacy` (`race_id`);--> statement-breakpoint
CREATE INDEX `candidacy_status_event_idx` ON `candidacy_status_event` (`candidacy_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `person_sort_name_idx` ON `person` (`sort_name`);--> statement-breakpoint
CREATE INDEX `person_identifier_person_idx` ON `person_identifier` (`person_id`);