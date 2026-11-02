CREATE TABLE `correction_request` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state` enum('new','in_review','fixed','no_change','spam') NOT NULL DEFAULT 'new',
	`page_path` varchar(500),
	`description` varchar(4000) NOT NULL,
	`evidence_url` varchar(2048),
	`contact_email` varchar(254),
	`ip_address` varchar(45),
	`submitted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`internal_note` varchar(2000),
	`public_note` varchar(1000),
	`resolved_by` int,
	`resolved_at` datetime(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `correction_request_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coverage_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` int NOT NULL,
	`cycle_year` smallint NOT NULL,
	`office_level` enum('federal','state','local') NOT NULL,
	`level` enum('none','partial','complete') NOT NULL,
	`as_of` date,
	`note` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `coverage_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `coverage_status_uq` UNIQUE(`jurisdiction_id`,`cycle_year`,`office_level`)
);
--> statement-breakpoint
ALTER TABLE `correction_request` ADD CONSTRAINT `correction_request_resolved_by_admin_user_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `coverage_status` ADD CONSTRAINT `coverage_status_jurisdiction_id_jurisdiction_id_fk` FOREIGN KEY (`jurisdiction_id`) REFERENCES `jurisdiction`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `correction_request_state_idx` ON `correction_request` (`state`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `correction_request_ip_idx` ON `correction_request` (`ip_address`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `correction_request_log_idx` ON `correction_request` (`resolved_at`);