# Handoff - droplet relay, 6 Oct 2026 ~04:20Z

## Live (PROD)
- main aca0570, prod dpl_5NSekoCP (share card v3). Rollback: dpl_HGGj3rf8.
- Shipped 5 Oct:
  - U1-U7: play-daily-grid, poller-boot-check, daily-pool-small, slug-collision,
    cfb-hide-score, widget-top-points, october-late-games
  - daily-bar-tabbar, tagline + Play header (v2), series line, share card v2 -> v3
- Poller release: ~/deploy/sportsvyn/current = 1cd19ef. Web-only ships since then
  needed no redeploy.
- Migrations: ledger at 129 (daily_board_runs.tz), DEV and PROD. 0 pending.
- 2014 restored: Daily pool = 24 seasons (2002-2025).
- October: late games now join open cards (mlb-advance runs from release 1cd19ef).
- Rule B (firewall market-filter-crawl) is still LOG.

## Held / queue (quiet window: no game live)
1. COLOURS STACK 0565a54 (main + feed-alt-colours 2383cee + team-colours-fill 59087be)
   - Full suite 6171/6171; preview 3edh9rqok Ready; fast-forward from main.
   - Ship it, served check, then:
       DATABASE_URL="$PROD_DATABASE_URL" node scripts/team-colours-fill.mjs --apply
     (in the sv-team-colours worktree or main after merge)
   - Expect: CFB no-colour 105 -> 9 (96 filled, 9 primary-only); EPL 20 -> 0.
     Re-count before/after.
   - Dry runs: scratchpad (lost on /clear). Re-run without --apply to see the list.
2. mon-21 share text: when sharing FILES, put the link only in `text` and drop
   `url`. Keep `url` for the text-only bridge (lib/daily/shareRoute.js).
3. session-hygiene branch (this file + CLAUDE.md rules): full suite + preview, then ship.
4. Later, own branches:
   - FCS abbreviation fill: 105 teams, from CFBD.
   - The 9 CFB schools left colourless (CFBD gives a black placeholder):
     Campbell, East Texas A&M, Lindenwood, Mercyhurst, Merrimack, North Alabama,
     Stonehill, Tarleton State, Utah Tech. Needs a reviewed fix.
   - Morning email (not built): add optional widget gameOfTheDay {slug, cardUrl, series}.

## Open questions for Derik
- Confirm one real share tap on iOS app 1.5. Native share with files is still
  unconfirmed; the download + copy fallback stays meanwhile.
- MCP/plugin trim for this repo (tue-1 item 5): see docs/reports/2026-10-06-session-audit.md.

## Scheduled checks (read-only)
- Retention apply: Tue 09:43Z, check 09:52Z.
- Firewall day-2 + Rule B decision: Tue 14:17Z.
- CFBD quota alert wiring: not before 12 Oct.
- CFB win-prob re-score reminder: 26 Oct.

## Gate mechanics (unchanged)
- Full suite on the exact merge tree, with env:
    set -a && . ./.env.local && set +a && node --test $(git ls-files '*.test.mjs')
- Preview Ready for the exact commit. A ref pointing at an already-pushed commit
  builds nothing: start it via the Vercel API by SHA.
- Reset parity-intent.json after merging a branch that declares entries.
- Never merge while a game is live, unless Derik says so.
- DEV deletes: list first, write a JSONL undo file to ~/dev-undo/.

## Next step
Quiet window is open now (04:13Z, nothing live): ship item 1, apply the fill,
then items 2-3.
