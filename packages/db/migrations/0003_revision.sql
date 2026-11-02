CREATE TABLE `revision` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(64) NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`author_id` varchar(100) NOT NULL,
	`note` varchar(1000),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `revision_id` PRIMARY KEY(`id`),
	CONSTRAINT `revision_entity_version_uq` UNIQUE(`entity_type`,`entity_id`,`version`)
);
