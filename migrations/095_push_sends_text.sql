-- 095_push_sends_text.sql - record WHAT was sent, not just that it was.
--
-- push_sends carried device_token, match_id, event_key, sent_at, ok,
-- status_code and error - everything about the delivery and nothing about
-- the message. So "did any alert on 5 Sep carry a team name in its score
-- prefix?" could not be answered from the table at all; it had to be
-- inferred from which commit the poller had loaded.
--
-- WRITTEN ON THE CLAIM ROW, before the send is attempted (lib/push/
-- dispatch.js), so the text survives a delivery that then fails - which is
-- precisely the row you most want to read afterwards.
--
-- NULLABLE, because every row already in the table predates this and there
-- is no honest way to reconstruct what they said. A null here means "sent
-- before we recorded text", never "sent with no text".

ALTER TABLE push_sends ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE push_sends ADD COLUMN IF NOT EXISTS body  text;

COMMENT ON COLUMN push_sends.title IS 'Notification title as sent. NULL for rows written before migration 095.';
COMMENT ON COLUMN push_sends.body  IS 'Notification body as sent. NULL for rows written before migration 095.';
