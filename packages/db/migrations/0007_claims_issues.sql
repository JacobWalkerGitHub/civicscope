CREATE TABLE `claim` (
	`id` int AUTO_INCREMENT NOT NULL,
	`person_id` int NOT NULL,
	`kind` enum('position','biography','accomplishment') NOT NULL,
	`content_kind` enum('sourced_fact','candidate_claim','independent_analysis','editorial_summary') NOT NULL,
	`title` varchar(200) NOT NULL,
	`summary` varchar(2000) NOT NULL,
	`quote` varchar(2000),
	`issue_id` int,
	`position_type` enum('stated_position','campaign_promise','public_statement'),
	`bio_category` enum('education','employment','military','public_service','civic','other'),
	`organization` varchar(200),
	`stated_on` date,
	`venue` varchar(200),
	`start_year` smallint,
	`end_year` smallint,
	`verification_status` enum('unverified','pending_review','verified','disputed','outdated') NOT NULL DEFAULT 'unverified',
	`last_edited_by` int,
	`submitted_at` datetime(3),
	`review_note` varchar(1000),
	`verified_at` datetime(3),
	`verified_by` int,
	`publish_state` enum('draft','published','unpublished','archived') NOT NULL DEFAULT 'draft',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `claim_id` PRIMARY KEY(`id`),
	CONSTRAINT `claim_position_fields` CHECK((`claim`.`kind` = 'position') = (`claim`.`issue_id` IS NOT NULL AND `claim`.`position_type` IS NOT NULL)),
	CONSTRAINT `claim_bio_fields` CHECK((`claim`.`kind` = 'biography') = (`claim`.`bio_category` IS NOT NULL)),
	CONSTRAINT `claim_year_order` CHECK(`claim`.`start_year` IS NULL OR `claim`.`end_year` IS NULL OR `claim`.`end_year` >= `claim`.`start_year`),
	CONSTRAINT `claim_published_is_verified` CHECK(`claim`.`publish_state` <> 'published' OR `claim`.`verification_status` IN ('verified', 'disputed', 'outdated'))
);
--> statement-breakpoint
CREATE TABLE `issue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(100) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `issue_id` PRIMARY KEY(`id`),
	CONSTRAINT `issue_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `citation` MODIFY COLUMN `subject_type` enum('person','candidacy','claim') NOT NULL;--> statement-breakpoint
ALTER TABLE `claim` ADD CONSTRAINT `claim_person_id_person_id_fk` FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `claim` ADD CONSTRAINT `claim_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `claim_person_idx` ON `claim` (`person_id`,`kind`);--> statement-breakpoint
CREATE INDEX `claim_review_idx` ON `claim` (`verification_status`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `claim_issue_idx` ON `claim` (`issue_id`);