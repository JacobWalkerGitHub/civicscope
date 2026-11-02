-- Revisions are history: they may be added but never changed or removed by the app.
CREATE TRIGGER `revision_no_update` BEFORE UPDATE ON `revision`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'revision is append-only: UPDATE is not allowed';
--> statement-breakpoint
CREATE TRIGGER `revision_no_delete` BEFORE DELETE ON `revision`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'revision is append-only: DELETE is not allowed';
