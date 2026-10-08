# Crew tools (wed-4)

Installed copy: `~/crew/bin` and `~/crew/lib` on the droplet; this directory is the reviewed source.
Read-only scripts the mini's WATCHER key may run (forced command `~/crew/bin/dispatch`):
app-errors, vercel-errors, cf-top, retention-status, provider-health, cost-watch, latest-deploy.

- Tokens stay on the droplet: the Vercel CLI login, `~/crew/secrets/*.env|*.url` (chmod 600).
- DB reads go through `crew_reader` (scripts/crew-reader-grants.mjs): no write grants, read-only by default.
- provider-health / retention-status run the SQL in docs/crew/watch-rules.md of the DEPLOYED release.
- Not configured until Derik adds them: `~/crew/secrets/cloudflare.env` (CF_API_TOKEN, CF_ZONE_ID),
  `~/crew/secrets/neon.env` (NEON_API_KEY, NEON_PROJECT_ID).

Install / update: `cp scripts/crew/bin/* ~/crew/bin/ && cp scripts/crew/lib/* ~/crew/lib/ && chmod 700 ~/crew/bin/* && chmod 600 ~/crew/lib/*`
