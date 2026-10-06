# Handoff - droplet relay, 6 Oct 2026 ~05:45Z

## Live (PROD)
- main 74f8ce3 (mon-21 share text). Before it: 2e31fee (colours stack),
  prod dpl_A9ZHLjT2. Rollback: dpl_5NSekoCP (share card v3, aca0570).
- Shipped 6 Oct (report: docs/reports/2026-10-06-colours-and-share.md):
  - Colours stack: feed-alt-colours (widget awayAltColor/homeAltColor) +
    team-colours-fill script + seasonBoardTick F2 test fix.
  - team-colours-fill --apply on PROD: CFB no-colour 105 -> 9 (9 primary-only),
    EPL 20 -> 0.
  - mon-21: a files share is { files, text }, link in the text only; the bridge keeps {url, title}.
  - session-hygiene (9422b6e) was already on main at session start.
- Poller release: ~/deploy/sportsvyn/current = 1cd19ef. All ships since then
  are web-only, so no redeploy is needed.
- Migrations: ledger at 129, DEV and PROD. 0 pending.
- Rule B (firewall market-filter-crawl) is still LOG.

## Queue (quiet window: no game live)
1. FCS abbreviation fill: 105 teams, from CFBD, on its own branch.
2. The 9 CFB schools left colourless (CFBD gives a black placeholder):
   Campbell, East Texas A&M, Lindenwood, Mercyhurst, Merrimack, North Alabama,
   Stonehill, Tarleton State, Utah Tech. Needs a reviewed static entry in
   lib/cfb/teamColors.js; then rerun team-colours-fill.
3. Morning email (not built): add optional widget gameOfTheDay {slug, cardUrl, series}.

## Open questions for Derik
- seasonBoardTick F2 calls the REAL notifyEvent from DEV and reaches
  api.push.apple.com. 3 DEV device rows, all gone, so 0 were delivered. Should
  F2 use a mock sender, or stay as a real proof?
- Confirm one real share tap on iOS app 1.5. That covers files + text, and
  the link should appear once.
- DEV leak: every full run leaves one deadlinetest-*-user (04:55, 05:08, 05:19 today); a killed
  run left sentinel-widget-1791264642048-* (removed; undo in ~/dev-undo/) and
  prefsroute-1791264640415 (left).
- MCP/plugin trim (tue-1 item 5): see docs/reports/2026-10-06-session-audit.md.

## Scheduled checks (read-only)
- Retention apply: Tue 09:43Z, check 09:52Z.
- Firewall day-2 + Rule B decision: Tue 14:17Z.
- CFBD quota alert wiring: not before 12 Oct.
- CFB win-prob re-score reminder: 26 Oct.

## Gate mechanics (unchanged)
- Full suite on the exact merge tree, with env:
    set -a && . ./.env.local && set +a && node --test $(git ls-files '*.test.mjs')
- Preview Ready for the exact commit (Vercel team team_zIjdhUJZ8BmNah6Bqx00je4P).
- Reset parity-intent.json after merging a branch that declares entries.
- Never merge while a game is live, unless Derik says so.
- DEV deletes: list first, write a JSONL undo file to ~/dev-undo/.

## Next step
Start a fresh session: read this file, then queue item 1 in the next quiet window.
