CREATE TABLE `fec_outside_spending` (
	`id` int AUTO_INCREMENT NOT NULL,
	`candidate_id` char(9) NOT NULL,
	`cycle` smallint NOT NULL,
	`committee_id` char(9) NOT NULL,
	`committee_name` varchar(200) NOT NULL,
	`support_oppose` char(1) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	CONSTRAINT `fec_outside_spending_id` PRIMARY KEY(`id`),
	CONSTRAINT `fec_outside_spending_uq` UNIQUE(`candidate_id`,`cycle`,`committee_id`,`support_oppose`)
);
