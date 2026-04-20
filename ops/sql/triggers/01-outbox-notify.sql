-- NOTIFY on outbox INSERT. ARCHITECTURE.md §8.
--
-- apps/listen-notify runs `LISTEN outbox_event;` and on each notification
-- reads the newly-committed rows and enqueues them into BullMQ. Using
-- pg_notify inside an AFTER INSERT trigger means the notification only
-- fires after COMMIT, so listeners never see uncommitted rows.

CREATE OR REPLACE FUNCTION outbox.notify_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Payload must be < 8000 bytes. Keep it small — carries id only,
  -- listener reads the full row.
  PERFORM pg_notify(
    'outbox_event',
    json_build_object('id', NEW.id, 'type', NEW.event_type)::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_notify_trigger ON outbox.events;
CREATE TRIGGER outbox_notify_trigger
AFTER INSERT ON outbox.events
FOR EACH ROW
EXECUTE FUNCTION outbox.notify_event();
