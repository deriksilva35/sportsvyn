# coins-1 Part A recon (20 Oct 2026), branch coins-drum. Read-only; no DB queries.

## 1 Settlement hooks (settled write; rank)
| game | settle fn | settled write | rank stored |
| --- | --- | --- | --- |
| Daily v2 | NONE: closed = daily_boards.closes_at <= now() (migration 090); tick only makes boards + pushes | none | no: rank() on read, lib/daily/seasonBoardLeaderboards.js:80-91 |
| Weekly | lib/weekly/settle.js:154 settleContest via settleDue('weekly') <- cron weekly-settle | settle.js:361 contests.settled, AND NOT settled | no: ce.score; rank on read lib/games/leaderboard.js:18 |
| Draft (weekly) | same settleContest via settleDue('draft') <- cron draft-settle | settle.js:361 | no |
| Primetime Draft | lib/draftGame/settle.js:164 settleGameBoard <- draft-game-settle | :211 (+ meta.entrants, ce.meta.result.top_pct) | place no; top_pct yes |
| Pick'em | lib/pickem/settle.js:207 settleDuePickem -> football :120, MLB series seriesPickem.js:221, NBA day dayPickem.js:282 | settle.js:191, seriesPickem.js:247, dayPickem.js ~:340 | no: competitionRank lib/results/pickem.js:83 (pct for confidence) |
| The Run | lib/run/settle.js:188 settleRunRound <- run-settle | :260 | no; DNF = score 0, meta.run.state |
| October | lib/october/settle.js:143 settleOctoberDay <- october-settle | :203 | no; DNF via meta.october.state |
All settles are idempotent (AND NOT settled); regrade windows exist (weekly 7 d, pickem). Void-all closes
settled=true with no scores (meta.void_all) - must earn nothing. Shared ranker: lib/games/rank.js:120
competitionRank (1-1-3).

RECOMMENDATION: one minting sweep, not six hooks. A job reads contests settled in the week (not void_all)
plus Daily boards past closes_at, computes rank with competitionRank, and inserts arcade_points under the
UNIQUE(user, contest, event) key. Same result, one place, survives a regrade, and catches a settle path
added later. Hooks inside each settle fn would be 8 call sites in 6 files.

## 2 Entrant counts
Stored only for Primetime Draft (contests.meta.entrants). Everything else derives:
contest_entries WHERE score IS NOT NULL (minus DNF for Run/October); Daily = daily_board_runs completed AND
NOT late_claim. Guests (daily_guest_runs) have no user: they count toward the field but earn nothing.
No count or leaderboard excludes users.is_house today - the sweep must (JOIN users, NOT is_house), for both
"< 10 entrants" and the 25%/10% cut.

## 3 Push + email
Push: lib/push/notify.js:89 notifyPersonalized(eventId, [{userId, params}]) - send-once claim in sync_runs,
copy from lib/push/copy.js (new event ids needed), tokens via device_tokens, dead-token strikes. It does not
read alert_prefs; a results push needs its own filter (master off).
Email: lib/email/morningSend.js resendSend + welcomeEmail.js unsubscribeUrlFor / clickUrlFor /
unsubscribeHeaders + suppression isHardBounced - the A/B plumbing, reusable as is. Routing through resendSend
keeps lib/email/suppression.test.mjs (THE GUARD) satisfied.

## 4 Cron + DST
Weekly crons: power-edition route shape (cronAuthorized, withAdvisoryLock, recordRun, maybeAlert). Vercel
is UTC only and no in-route local-time guard exists. Proposal: two schedules, Tue 16:00Z (PDT) and 17:00Z
(PST), route runs only when America/Los_Angeles time is >= Tue 09:00 and the week is not yet drawn
(coin_weeks.drawn_at claim) - the second firing is a no-op. lib/time/zoneGuard.test.mjs polices zone
literals: the PT constant goes where it allows.

## 5 Tremendous
Nothing in the repo, nothing in .env.local. Derik to create (sandbox first, testflight.tremendous.com):
TREMENDOUS_API_KEY (sandbox key), TREMENDOUS_FUNDING_SOURCE_ID, TREMENDOUS_CAMPAIGN_ID (one campaign with
Amazon allowed, or the Amazon US product id as TREMENDOUS_PRODUCT_AMAZON_US), TREMENDOUS_WEBHOOK_SECRET,
and TREMENDOUS_ENV=sandbox|production. $10 and $25 are denominations on one product, not two ids.

## 6 Age
users.date_of_birth DATE (migration 124), full date, nullable (NULL = never asked). 18+ is derivable with
lib/auth/ageGate.js:57 ageOn(dob, now). Under-13 answers are never stored. The column is allowlisted:
lib/auth/ageGateDob.test.mjs fails on any new file that names it - lib/coins must be added to that list.
NULL DOB (older accounts) cannot be shown 18+; the first-win sheet's 18+ confirm covers it.

## Rules vs mock (also in docs/design/coins-drum-spec.md)
Mock pays whole coins per finish, rules pay points; mock shows city, rules say state; minors' coins are
never entered, so no auto-drop for them.
