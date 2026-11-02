-- The audit log is append-only: history must never be rewritten through the app.
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: UPDATE is not allowed';
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only: DELETE is not allowed';
