-- 129_daily_board_runs_tz.sql - THE ZONE A DAILY RUN WAS PLAYED IN.
--
-- Relay mon-12: the morning push ("Yesterday's picks are out - see how you
-- did") goes to each player of yesterday's board at 9:00 AM in THEIR zone
-- (lib/daily/morningPush.js). Nothing on the server stored a reader's zone:
-- it lives in the sv_tz cookie (lib/gridiron/viewerTz.js), which the server
-- sees only during a request. POST /api/daily/board/start reads it and stamps
-- it here, on the row the start already writes.
--
-- ON THE RUN, NOT ON users. The run is the thing the push is about, and a zone
-- fixed per run puts each player in exactly ONE morning wave per board (the
-- wave's event id carries the zone) - a zone that moved under them between
-- two waves could otherwise put them in two.
--
-- NULLABLE, NO BACKFILL. A run with no zone (every run before this, and any
-- start without the cookie) is pushed at 9:00 AM ET - the Daily's own zone.
-- The reader tolerates the column being absent too, so the code can ship
-- before this is applied.

ALTER TABLE daily_board_runs ADD COLUMN IF NOT EXISTS tz text;
