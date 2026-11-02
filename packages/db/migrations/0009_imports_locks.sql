CREATE TABLE `field_lock` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entity_type` varchar(32) NOT NULL,
	`entity_id` int NOT NULL,
	`field` varchar(64) NOT NULL,
	`locked_by` int NOT NULL,
	`reason` varchar(200) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `field_lock_id` PRIMARY KEY(`id`),
	CONSTRAINT `field_lock_uq` UNIQUE(`entity_type`,`entity_id`,`field`)
);
--> statement-breakpoint
CREATE TABLE `import_batch` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('candidates') NOT NULL,
	`state` enum('preview','applied','discarded') NOT NULL DEFAULT 'preview',
	`race_id` int NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`csv_text` mediumtext NOT NULL,
	`source_ref` json NOT NULL,
	`source_id` int,
	`summary` json,
	`created_by` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`closed_by` int,
	`closed_at` datetime(3),
	CONSTRAINT `import_batch_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_item` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('field_conflict') NOT NULL,
	`state` enum('open','accepted','rejected') NOT NULL DEFAULT 'open',
	`entity_type` varchar(32) NOT NULL,
	`entity_id` int NOT NULL,
	`field` varchar(64) NOT NULL,
	`current_value` json,
	`proposed_value` json,
	`detail` json,
	`source_id` int NOT NULL,
	`import_batch_id` int,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`resolved_by` int,
	`resolved_at` datetime(3),
	`resolution_note` varchar(500),
	CONSTRAINT `review_item_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `field_lock` ADD CONSTRAINT `field_lock_locked_by_admin_user_id_fk` FOREIGN KEY (`locked_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batch` ADD CONSTRAINT `import_batch_race_id_race_id_fk` FOREIGN KEY (`race_id`) REFERENCES `race`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batch` ADD CONSTRAINT `import_batch_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batch` ADD CONSTRAINT `import_batch_created_by_admin_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batch` ADD CONSTRAINT `import_batch_closed_by_admin_user_id_fk` FOREIGN KEY (`closed_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_item` ADD CONSTRAINT `review_item_source_id_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_item` ADD CONSTRAINT `review_item_import_batch_id_import_batch_id_fk` FOREIGN KEY (`import_batch_id`) REFERENCES `import_batch`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `review_item` ADD CONSTRAINT `review_item_resolved_by_admin_user_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `import_batch_state_idx` ON `import_batch` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_item_state_idx` ON `review_item` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_item_entity_idx` ON `review_item` (`entity_type`,`entity_id`);