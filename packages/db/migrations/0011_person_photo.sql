CREATE TABLE `person_photo` (
	`id` int AUTO_INCREMENT NOT NULL,
	`person_id` int NOT NULL,
	`content_type` varchar(32) NOT NULL,
	`data` mediumblob NOT NULL,
	`byte_size` int NOT NULL,
	`sha256` char(64) NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`credit` varchar(200) NOT NULL,
	`uploaded_by` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `person_photo_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `person` ADD `photo_id` int;--> statement-breakpoint
ALTER TABLE `person_photo` ADD CONSTRAINT `person_photo_person_id_person_id_fk` FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `person_photo_person_idx` ON `person_photo` (`person_id`);