# Handoff - droplet relay wed-2, Thu 15 Oct 2026 (clock ~16:30Z)

## Live (PROD) - main 0fd7ea6; Vercel auto-deploys web; poller unchanged (93a36a4)
- ARCADE EMAIL SENT 15 Oct 16:26:02-16:27:51Z: 292 sent, 0 failed, 0 skipped + owner verify copy
  (sync_runs kind=send x292, owner-verify x1, campaign c1c2ab2e...). Files: docs/email/arcade-2026-10-15.{html,txt}, images at
  sportsvyn.com/email/arcade/ (13 PNGs, 1200 wide, <150 KB; test pins them in lib/email/broadcastRules.test.mjs).
  Blocks: Daily (2016 shots, pool "seasons from 2002 to 2025" = RANKED_MIN_SEASON..max), Pick'em,
  EPL Weekly 5, Draft, Weekly, October, Run, Primetime, Mocks, Coming soon, App (listing name "Draftvyn").
  LIGHT ARCADE LOOK (white, indigo #1A1650, lime chips/buttons, Rubik + Arial fallbacks, brand-kit
  light wordmark centered + "THE ARCADE OF SPORTS"). Campaign sha c1c2ab2e...; PROD dry run RECIPIENTS 292 (111 Apple relay); house accounts excluded.
  Last test: Resend 01a14057-d549-711d-8a37-d46376f94798 to deriksilva@gmail.com.
- ONE-CLICK UNSUBSCRIBE (RFC 8058): POST /api/email/unsubscribe live (200 signed / 400 tampered); GET kept.
- CI: .github/workflows/tests.yml exits 0 with a notice while CI_DATABASE_URL is unset (verified green
  on 0fd7ea6). Set the secret (crew, "ci" Neon branch) and the full suite runs again unchanged.
- REPLY-TO derik@sportsvyn.com on every mail (lib/resend.js EMAIL_REPLY_TO; welcome + broadcast).
- Postal address in .env.local: 3494 Camino Tassajara #1055, Danville CA 94506 (EMAIL_POSTAL_ADDRESS).
- Earlier: Top 25 memory, /mock/nfl entry, Daily lock-in (migration 142), NFL mock, crew_stats (143),
  crew_reader revokes (245e8b5). Details in git log and docs/reports/.

## After the send
- Watch: bounces/complaints (Resend webhook -> sync_runs), unsubscribes (users.email_opted_out_at since
  16:26Z), clicks (sync_runs kind=click, campaign c1c2ab2e). A re-run of --send skips the 292 already sent.

## Screenshot method (wed-2)
- playwright-core + chrome-headless-shell in the session scratchpad (gone after /clear), 393x852 @3x,
  against PROD. Signed-in shots need a throwaway user + session row + handle/onboarded_at set.
  Cleanup: inventory every user-keyed table, write a JSONL undo, delete in one transaction, re-sweep.
  wed-2 throwaways 351 and 352 and guest runs 16-19 are deleted (undo files were in the scratchpad).
- Not shot: The Run (round locked for a new account), the Pick'em confidence rank sheet.

## Needs Derik
- Leagues (thu-2 recon): no feed/chat/league push today. Sizes: chat+moderation L 8-12 d, feed M 2-3 d,
  H2H M-L 3-5 d, kick/leave S 1 d, standings polish S, league push S-M. Which first?
- Leagues P1 questions (sun-4): total points model, bots in 4-7 team leagues, live sync method, K/DST.
- Unclaimed guest rows from wed-7/mon-4/5; Neon "ci" key; Cloudflare token; crew_reader password for a run AS it.

## Queue
1. 20 Oct: docs launch-oct20 checks 6-13 (NBA tips off; NBA Game Drafts stay OFF until DRAFT_GAME_NBA).
2. Mon 19 Oct: first live CFB 25 reminder send - verify it. Mon 26 Oct: CFB win-prob re-score prompt.
3. Leagues work per Derik's pick above. Morning email (add gameOfTheDay when built).
4. Draft look: open a weekly wk6 room signed in (Mac) and confirm it.
5. TICKET: suite tests mutating real DEV boards must use own fixtures. FCS abbreviations, 9 colourless CFB schools.

## Notes
- PROD reads/writes for the email shots were Derik-authorized for wed-2 only.
- neon: `interval ${'..'}` is a syntax error; route files export no helpers.
- DEV: draft contest 55759 (week 99) shadows the weekly contest; orphan sweep lists 3,779 old test users.

## Next step
Check the arcade email's bounces/unsubs/clicks tomorrow. 20 Oct: launch-oct20 checks 6-13.
