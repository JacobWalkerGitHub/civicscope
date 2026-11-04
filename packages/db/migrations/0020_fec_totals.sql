CREATE TABLE `fec_candidate_totals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`candidate_id` char(9) NOT NULL,
	`cycle` smallint NOT NULL,
	`receipts` decimal(14,2),
	`disbursements` decimal(14,2),
	`cash_on_hand` decimal(14,2),
	`debts` decimal(14,2),
	`coverage_start` date,
	`coverage_end` date,
	`source_updated_at` varchar(40),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `fec_candidate_totals_id` PRIMARY KEY(`id`),
	CONSTRAINT `fec_candidate_totals_uq` UNIQUE(`candidate_id`,`cycle`)
);
--> statement-breakpoint
ALTER TABLE `ingest_run` MODIFY COLUMN `source` enum('fec','congress_legislators','congress_gov','state_results','openstates','fec_totals') NOT NULL;