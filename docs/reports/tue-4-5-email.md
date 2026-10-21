# tue-4 / tue-5 - email pacing, measuring, test accounts, 6 AM preview, DST

## A. Rate limit (one place)
- `lib/email/resendPace.js` `paced()` wraps `resend.emails.send` in `lib/resend.js`, so EVERY sender gets it:
  morning send, NBA opener, welcome, sign-in codes, newsletter confirmation, alerts, CFB reminder, broadcast script.
- Pace: send starts >= 125 ms apart (<= 8/s); slots are reserved synchronously so concurrent callers queue.
- Retry: a Resend 429 (`rate_limit_exceeded`, "Too many requests"; returned or thrown) is retried 3 times with
  500 / 1000 / 2000 ms backoff, each retry paced. Then the error comes back and the caller counts it failed.
  A 429 is a refusal, so a retry cannot duplicate a message. Non-429 errors are never retried.
- Tests: fake 429 twice then ok = sent; four 429s = failed; thrown 429; pacing and queueing on an injected clock;
  a guard that nothing but `lib/resend.js` builds a Resend client.

## B. Measure
- Webhook (`app/api/webhooks/resend`) now stores `email.opened` (kind `opened`) and `email.clicked` (kind `clicked`,
  `summary.link`), with `summary.at` = Resend's event time. Existing kinds untouched.
- Scanner rule (`lib/email/emailMetrics.js`, pure): 3+ clicks inside 15 s on one message (webhook: messageId) or one
  account + campaign (our `email-click` ledger), where the burst STARTS within 2 minutes after delivery (webhook: the
  `email.delivered` time; our ledger: when we handed the send to Resend). Every click in the burst is excluded from
  every count. No known delivery time = not flagged. Constants live in that file.
- Admin: `/admin/morning-email` (existing page) gains "Last 14 days": sent, delivered, opened, real clicks, scanner
  clicks (excluded), recipients who played that day. "Played" = Daily run completed, contest entry created (Pick'em,
  Weekly, Draft game, October, The Run ...), or a draft started, within the ET day. Source: `lib/email/morningStats.js`.
  Our own click-ledger numbers are computed (`ourClicks`) but not shown.
- RESEND DASHBOARD (Derik): open/click tracking is a per-DOMAIN setting, not per email. All mail uses
  `Sportsvyn <hello@sportsvyn.com>` (`lib/resend.js`), so the domain is sportsvyn.com. Turn Open Tracking and
  Click Tracking ON for sportsvyn.com (Domains), and subscribe the existing webhook (`/api/webhooks/resend`) to
  `email.opened` and `email.clicked`. Caveat: the setting covers every email from that domain (welcome, sign-in
  codes, alerts), not just the morning email; the morning email's links are already our own signed redirects, and
  Resend's tracking would rewrite the rest. Until it is on, those columns read 0.

## C. Test accounts get the Daily email
- `lib/email/testAccounts.js` (pure `addressVerdict` / `testAccountVerdict`) and `testAccountRoster` /
  `morningAudience` in `lib/email/morningAudience.js`. An owner-address or house account is mailed (reason `test`,
  regardless of the 30-day / 14-day rule) when its address is a real mailbox. Dropped for: no-address, malformed,
  placeholder (example.com/.org/.net and subdomains, .test, .invalid, .local, .localhost, .example, .internal,
  `test.` hosts, sentinel local parts mtest-/bouncetest-/sentinel/probe-/fixture/fake/dummy), opted-out
  (unsubscribed or Morning email OFF at /you), hard-bounced.
- House accounts stay out of played count / top players / leaderboards (unchanged queries in `loadDay`).
- PROD read-only list (12 accounts): see the PR / final message.

## D. 6 AM preview
- `lib/email/morningPreview.js` + `/api/cron/morning-preview`. To `MORNING_PREVIEW_TO` (default derik@sportsvyn.com;
  must be in OWNER_ADDRESSES and not a placeholder), user resolved by address (PROD user 5). Subject
  `[PREVIEW 8AM] <real subject>`, YOUR MOVE included, plain site links (no click ledger). Runs with MORNING_EMAIL off.
- Ledger: `sync_runs` source `morning-preview` kind `send` {day, to, userId, outcome}; one insert-if-absent statement
  enforces once per day per recipient; a `failed` row allows a retry. Never writes `morning-email` rows.
- First preview: Wed 21 Oct 13:00Z (6 AM PDT).

## E. DST
- Both crons fire hourly (`0 * * * *`). `lib/email/schedule.js` reads the Pacific clock (Intl America/Los_Angeles):
  real send acts in the 8 o'clock hour, preview in the 6 o'clock hour. Other firings record `not-the-hour` (the
  cron watchdog's liveness row; its schedule entries are now `0 * * * *`, plus a `morning-preview` entry).
- Real send: 15:00Z through Sat 31 Oct, 16:00Z from Sun 1 Nov. Preview: 13:00Z, then 14:00Z from Sun 1 Nov.
  Behaviour before 1 Nov is unchanged (15:00Z).
- Once per day: the per-user ET-day ledger (`alreadyMorning`) and the preview's per-day row. Tests tick hourly across
  29 Oct to 3 Nov and assert exactly one 8 AM and one 6 AM firing per Pacific day.
- Trade-off: a missed 8 o'clock firing is not retried in the 9 o'clock hour (the gate is the Pacific hour). The
  watchdog sees a missing `not-the-hour`/run row but not a missing send; the 8 AM run's own failure alert is unchanged.
