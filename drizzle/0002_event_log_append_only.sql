-- The event log is append-only: rows can be inserted, never changed or removed.
-- TRUNCATE is deliberately left allowed so test suites can reset the database.
CREATE FUNCTION reject_event_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_events_append_only
BEFORE UPDATE OR DELETE ON project_events
FOR EACH ROW EXECUTE FUNCTION reject_event_log_change();
