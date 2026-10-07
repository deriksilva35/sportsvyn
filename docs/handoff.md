# Handoff - droplet relay wed-3, 7 Oct 2026

## Live (PROD)
- main 0ce3057 = merge of league-formats-s2 (S2, league Pick'em formats). Vercel prod READY.
  - Create step: "How should your league score?" Regular / Confidence (mock copy, exact).
  - After a league's first week locks, a change is queued: "Switches to <Format> next season" + Undo.
  - The queued format applies when the next season's board is CREATED (ensurePickemBoard /
    NBA day board / MLB series board, the step that stamps scoring); never on a read.
  - ?league= Pick'em board ranks by the league's format (REGULAR = wins, CONFIDENCE = points).
- Migrations 133 + 134 applied and ledgered on PROD (and DEV). PROD --status: pending 0, CHANGED 0.
- Poller / daily-tick / mlb-advance on release 0ce3057 (proof 16:30:53Z).
- PROD's 8 existing leagues: all REGULAR, nothing queued, other columns byte-identical (md5).
- 30 min after: Vercel 0 runtime errors, poller 0 error lines.

## Held
- Nothing.

## Queue
1. 13 Oct watch: that morning's NFL/CFB boards must be REGULAR; the 20 Oct boards confidence.
2. ATS (S3: pick_format 'ats' is already allowed by 133's CHECK), FCS abbreviation fill,
   9 colourless CFB schools, morning email gameOfTheDay.
3. Pre-existing eslint error on main: react-hooks/purity at components/pickem/PickemBoard.js:150.
4. lib/pickem/entryFlow.test: two DEV tests are order-dependent in hand-run batches (green alone
   and in every full suite). Worth isolating its fixture.

## Open questions for Derik
- None new.

## Notes
- PICK_FORMAT_REFUSALS.locked is unreachable now (kept).
- Signed-in PROD page check: sentinel user (example.invalid, adult DOB, 10-min session), deleted
  after; the age screen is passed via /age/check following redirects (droplet cannot sign the
  age cookie itself).
- Worktrees: ../sv-tbd-locks and ../sv-s2 are both merged.
- lib/nba/replay.test.mjs collides when two suites share DEV: run gates alone.
- Detail: docs/reports/2026-10-07-wed3.md
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Watch the 13 Oct boards; then S3 (ATS).
