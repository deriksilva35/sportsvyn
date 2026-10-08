# Handoff - droplet relay wed-4, 7 Oct 2026 (crew setup)

## Live (PROD)
- main = 0ce3057 + docs (S2). Nothing product-side changed this relay.
- Droplet (outside git): ~/crew/{bin,lib,secrets,worktrees}; two mini keys in ~/.ssh/authorized_keys
  (watcher forced to ~/crew/bin/dispatch; fixer normal shell). Backup: ~/.ssh/authorized_keys.bak-wed4.
- DEV: migration 135 app_errors; role crew_reader (87 tables); sentinel user 117499.

## Held - HOLDING-FOR-GO
- crew-setup @ 2bac60b: app_errors + service hooks, scripts/suite.sh lock, crew docs, CI workflow,
  crew_reader grant script, scripts/crew/. Full suite 6329/6329 (722 s), preview READY.
- At GO, in this order:
  1. `DATABASE_URL="$PROD_DATABASE_URL" node scripts/apply-migrations.mjs 135_app_errors.sql`
  2. PROD role: new password into ~/crew/secrets/crew-reader-prod.env (quoted, chmod 600), then
     `node scripts/crew-reader-grants.mjs --prod --apply`; write crew-reader-prod.url
     (CREW_PROD_DATABASE_URL='...', QUOTED - unquoted & leaked the first DEV password); probe writes.
  3. Merge crew-setup into main (no rebase); `scripts/deploy-poller.sh origin/main` (services get
     the hooks; ~/crew rules read the deployed watch-rules.md).
  4. Verify: `~/crew/bin/app-errors`, `provider-health --all`, `retention-status` against PROD.

## Needs Derik
- Neon: create branch "ci" (from DEV) + add GitHub secret CI_DATABASE_URL; then a test PR for "tests".
  Or drop a Neon API key in ~/crew/secrets/neon.env and the relay does both (also enables cost-watch).
- Cloudflare: CF_API_TOKEN (Zone Analytics:Read) + CF_ZONE_ID in ~/crew/secrets/cloudflare.env.
- Move ~/crew/secrets/mini-keys/mini-{watcher,fixer} to the mini, then delete them here.

## Queue
1. 13 Oct watch: that morning's NFL/CFB boards REGULAR; 20 Oct boards confidence.
2. One PROD error seen: "AUTH_SECRET is not set - refusing to sign a guest token" (6 Oct, old deploy).
3. ATS (S3), FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Suite: `scripts/suite.sh` (or `npm test`) holds ~/.sportsvyn-suite.lock; ~12 min.
- Detail: docs/reports/2026-10-07-wed4.md
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Derik's GO for crew-setup (135 + PROD role + merge), and the Neon "ci" branch.
