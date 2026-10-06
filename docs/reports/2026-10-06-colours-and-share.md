# 6 Oct 2026 (05:00-05:40Z): colours stack + mon-21 share text

## Colours stack -> main 2e31fee (prod dpl_A9ZHLjT2, Ready, on sportsvyn.com)
- Re-merged on 9422b6e: feed-alt-colours 2383cee + team-colours-fill 59087be
  (branch window-stack-colours5). Clean merges, no parity-intent entries.
- First full suite: 6170/6171. The red one was not colours:
  lib/daily/seasonBoardTick.test.mjs "F2 proof" asserted EXACT equality on
  r.live. shareCardData.test (merged 5 Oct) creates a CLOSED 2019 board
  (CLOSED_DATE = 2019-<mmdd>) in DEV; running in parallel, the F2 tick at
  2099 caught up its daily-live:2019-08-28 too. Order-dependent, so earlier
  runs were green by timing.
- Fix 2e31fee: F2 checks that its own two events are present (the file's own
  countOf rule) and tears down a claim for every event its tick fired.
- Leaked DEV row removed: sync_runs 24498 (undo: ~/dev-undo/2026-10-06-sync_runs-24498.jsonl).
- Second full suite on 2e31fee: 6171/6171. Preview dpl_6VtWU7oz Ready.

## team-colours-fill --apply on PROD (05:29Z, fingerprint 90e84b2cd485)
|        | before (none) | after (none) | primary-only after |
|--------|---------------|--------------|--------------------|
| CFB    | 105 / 243     | 9            | 9                  |
| EPL    | 20 / 20       | 0            | 0                  |
96 CFB and 20 EPL rows updated. 1 CFBD call (quota 65078 left). Counted
independently by a separate query before and after; both match the script.

## mon-21 share text -> main 74f8ce3
- lib/daily/shareRoute.js: the files payload is { files, text }, with no url.
  withLink(text, url) keeps the text when it already carries the link
  (bare or https) and appends it otherwise. The bridge keeps { url, title }.
- Full suite on 74f8ce3: 6172/6172. Preview dpl_BggKodtn Ready.

## Worth Derik's eye (not changed)
- The F2 test calls the REAL notifyEvent from DEV, and its sync_runs summary
  showed host api.push.apple.com, env production, devices 3 (3 gone, 0 sent).
  So a DEV test run can reach real APNs for whatever DEV device rows exist.
  Today, 0 were delivered.
