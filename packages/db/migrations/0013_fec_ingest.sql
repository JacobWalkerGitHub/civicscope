CREATE TABLE `ingest_run` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` enum('fec') NOT NULL,
	`params` json NOT NULL,
	`state` enum('running','succeeded','failed') NOT NULL DEFAULT 'running',
	`started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`finished_at` datetime(3),
	`summary` json,
	`error` varchar(2000),
	`started_by` int,
	CONSTRAINT `ingest_run_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_snapshot` (
	`id` int AUTO_INCREMENT NOT NULL,
	`run_id` int NOT NULL,
	`url` varchar(2048) NOT NULL,
	`body` mediumtext NOT NULL,
	`fetched_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ingest_snapshot_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `candidacy` MODIFY COLUMN `status` enum('announced','registered','filed','qualified','withdrawn','disqualified','advanced','won','lost');--> statement-breakpoint
ALTER TABLE `candidacy_status_event` MODIFY COLUMN `status` enum('announced','registered','filed','qualified','withdrawn','disqualified','advanced','won','lost') NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batch` MODIFY COLUMN `kind` enum('candidates','fec') NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batch` ADD `ingest_run_id` int;--> statement-breakpoint
ALTER TABLE `ingest_run` ADD CONSTRAINT `ingest_run_started_by_admin_user_id_fk` FOREIGN KEY (`started_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_snapshot` ADD CONSTRAINT `ingest_snapshot_run_id_ingest_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `ingest_run`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ingest_run_source_idx` ON `ingest_run` (`source`,`started_at`);--> statement-breakpoint
CREATE INDEX `ingest_snapshot_run_idx` ON `ingest_snapshot` (`run_id`);--> statement-breakpoint
ALTER TABLE `import_batch` ADD CONSTRAINT `import_batch_ingest_run_id_ingest_run_id_fk` FOREIGN KEY (`ingest_run_id`) REFERENCES `ingest_run`(`id`) ON DELETE no action ON UPDATE no action;