CREATE TABLE `admin_invite` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token_hash` char(64) NOT NULL,
	`email` varchar(254) NOT NULL,
	`role` enum('owner','reviewer','editor','viewer') NOT NULL,
	`invited_by` int,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	`accepted_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `admin_invite_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_invite_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `admin_recovery_code` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`code_hash` char(64) NOT NULL,
	`used_at` datetime(3),
	CONSTRAINT `admin_recovery_code_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sign_in_challenge` (
	`id` char(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`ip_address` varchar(45),
	CONSTRAINT `sign_in_challenge_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_user` ADD `totp_secret` varchar(255);--> statement-breakpoint
ALTER TABLE `admin_user` ADD `totp_enabled_at` datetime(3);--> statement-breakpoint
ALTER TABLE `admin_user` ADD `totp_last_step` bigint;--> statement-breakpoint
ALTER TABLE `admin_invite` ADD CONSTRAINT `admin_invite_invited_by_admin_user_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `admin_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_recovery_code` ADD CONSTRAINT `admin_recovery_code_user_id_admin_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sign_in_challenge` ADD CONSTRAINT `sign_in_challenge_user_id_admin_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_invite_email_idx` ON `admin_invite` (`email`);--> statement-breakpoint
CREATE INDEX `admin_recovery_code_user_idx` ON `admin_recovery_code` (`user_id`);--> statement-breakpoint
CREATE INDEX `sign_in_challenge_user_idx` ON `sign_in_challenge` (`user_id`);