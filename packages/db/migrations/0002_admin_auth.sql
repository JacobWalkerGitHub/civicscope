CREATE TABLE `admin_session` (
	`id` char(64) NOT NULL,
	`user_id` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	`ip_address` varchar(45),
	`user_agent` varchar(500),
	CONSTRAINT `admin_session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_user` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`name` varchar(200) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('owner','reviewer','editor','viewer') NOT NULL DEFAULT 'viewer',
	`disabled_at` datetime(3),
	`last_sign_in_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_user_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `sign_in_attempt` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`ip_address` varchar(45),
	`succeeded` boolean NOT NULL,
	`attempted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sign_in_attempt_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_log` MODIFY COLUMN `action` enum('create','update','publish','unpublish','archive','restore','merge','split','import','delete','sign_in','sign_out','role_change') NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_session` ADD CONSTRAINT `admin_session_user_id_admin_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_session_user_idx` ON `admin_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `admin_session_expires_idx` ON `admin_session` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sign_in_attempt_email_idx` ON `sign_in_attempt` (`email`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `sign_in_attempt_ip_idx` ON `sign_in_attempt` (`ip_address`,`attempted_at`);