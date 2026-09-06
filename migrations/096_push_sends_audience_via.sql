-- 096_push_sends_audience_via.sql - which arm admitted the device.
--
-- audienceFor() admits a device by either of two paths: the reader follows
-- one of the teams, or the reader saved an alert_prefs row for the match.
-- Which one it was was thrown away, and it is not recoverable afterwards -
-- the pref source field does not answer it (a follow with no team-scoped
-- row resolves to DEFAULTS and reports source=default, which reads like
-- neither path).
--
-- That mattered the moment the follow path produced its first real audience:
-- a ledger could see the send but not whether the follow arm or the match
-- arm was what worked.
--
-- 'both' | 'follow' | 'match'. Nullable text, because every row already in
-- the table predates this and there is no honest way to reconstruct it -
-- NULL means "written before we recorded the path", never "no path".

ALTER TABLE push_sends ADD COLUMN IF NOT EXISTS audience_via text;

COMMENT ON COLUMN push_sends.audience_via IS 'How the device entered the audience - both | follow | match. NULL for rows written before migration 096.';
