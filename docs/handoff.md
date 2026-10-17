# Handoff - droplet relays fri-3 + sat-1, Sat 17 Oct 2026 (clock ~15:30Z)

## Live (PROD) - main 28944f2 (deployed ~14:24Z); poller unchanged (93a36a4)
- BOUNCE SUPPRESSION: lib/email/suppression.js. A hard-bounced address is never mailed again:
  welcome, the broadcast roster (WHERE clause; the arcade roster went 292 -> 285), the newsletter
  confirmation. The webhook now stores bounceType (a Transient bounce never suppresses). A guard
  walks every resend.emails.send(): a new sender (the morning email) must check, or be exempt by name.
- /scores TOP 25 (sat-1): after CFB on All; the first chip of CFB's conference row (before ACC),
  lime when on, combining with a conference and Yours. Checked on sportsvyn.com at 390 today:
  All [all, nfl, cfb, top25, mlb...], CFB [top25, ACC, ...], on = rgb(212,255,0), no sideways scroll.
- Two race/clock test fixes (main's own tests): propsHorizon's near fixture follows the real next
  EPL kickoff; most-drafted "board still reads" asserts a count.
- crew_reader (fri-1): column grants on users/sessions/Daily runs, PII withheld; docs/context.md on main.

## HOLDING FOR GO - leagues-draft-link (slice 3, option B)
- Branch @ 45fade3, worktree ~/projects/sv-draft-link. Suite 6517/0, preview READY on 45fade3.
- Report: docs/reports/2026-10-17-slice3-draft-link.md; shots in docs/reports/shots-2026-10-17-slice3/.
- Migration 145_league_draft_link.sql on DEV ONLY (draft_configs.league_id fantrax-only;
  player_leagues.kind + bots_on).
- GO ORDER:
  (1) 145 on PROD FIRST (merged code without it breaks every league page and /sim);
  (2) merge + deploy;
  (3) `DATABASE_URL="$PROD_DATABASE_URL" node scripts/link-draft-league.mjs --config 225 --prod`,
      then add --apply.
  Expect 1 league, 4 members (users 1/74/5/15), 4 join lines, 1 link; 41 keepers etc. unchanged.
- DEV proof: the demo league was linked by the real script, draft side identical (keepers hash
  included), torn down.

## Needs Derik
- GO for slice 3 (above). Decisions in the report:
  - a dead /join code stays dead;
  - bots_on is stored now and governs the shared draft (slice 4);
  - 3e (next season's import attaches to the same league) is not built.
- Slice 4 (slow league draft 8-10 d, then live 5-6 d) when ready. Chat slice. Morning email (thu-1 ruling).
- Leagues P1 questions (sun-4) still open; Neon "ci" key; Cloudflare token.

## Queue
1. After GO: slice 3 on PROD, as above; check /leagues/<id> as a member, /sim "Open league", an old /join.
2. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
3. TICKET: suite tests mutating real DEV boards use own fixtures. FCS abbreviations, CFB colours.

## Notes
- The headless browser is chromium_headless_shell-1248. Run `next dev` with ARCADE_THEME=on to
  match the live face. Sentinels need handle, onboarded_at and date_of_birth.
- main-candidate-* branches were only for previews of a merge tree; deleted after use.

## Next step
Derik's GO on slice 3 -> 145 on PROD -> merge -> link config 225.
