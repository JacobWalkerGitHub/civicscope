-- Status history is evidence: events may be added but never changed or removed by the app.
CREATE TRIGGER `candidacy_status_event_no_update` BEFORE UPDATE ON `candidacy_status_event`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'candidacy_status_event is append-only: UPDATE is not allowed';
--> statement-breakpoint
CREATE TRIGGER `candidacy_status_event_no_delete` BEFORE DELETE ON `candidacy_status_event`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'candidacy_status_event is append-only: DELETE is not allowed';
