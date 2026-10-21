# crew (SPORTSVŶN)

SOULs and project.yaml live in Drive CrewOS/crews/sportsvyn (single source; not copied here).

`crew/agents/` and `crew/project.yaml` were committed from Drive by #16 and are left as they are;
Drive is the source, the copies in this repo can lag it.

`crew/bin` is the reviewed source of the scripts CrewOS runs as SSH forced commands under user
`crew-sportsvyn` (`~/crew/bin`, with `crew/lib` beside it). They are plain node (>= 20.11, no
dependencies) and read-only. `dispatch` is the forced-command router: it runs ONE script from
`~/crew/bin` by name and passes only whole-number arguments.

Install / update (on the droplet, as crew-sportsvyn):

    mkdir -p ~/crew/bin ~/crew/lib && cp crew/bin/* ~/crew/bin/ && cp $(ls crew/lib/*.mjs | grep -v '\.test\.mjs$') ~/crew/lib/ && chmod 755 ~/crew/bin/*

## The contract (every script)

- No argument except the ones listed below; anything else is exit 2.
- Never prints a secret (token, URL with a password): every output line and error is scrubbed.
- Exit 0 ok / 1 regression found / 2 setup error (missing secret, unreachable DB or API, bad argument).
- The LAST stdout line is exactly one `SUMMARY <script> key=value ...` (space-separated, no spaces in
  values, `-` for empty or unknown). On exit 2 it is `SUMMARY <script> status=error reason=<why>`.
  `board-state` is the exception: it prints one state line and, on exit 2, nothing at all.
- At most 10 s (a 9.5 s deadline is enforced, every HTTP/DB call has a timeout); `data-keeper` is the
  one exception.
- Read-only. The DB is reached as `crew_reader` (SELECT on the `crew_stats` views; each call is a
  read-only batch that starts with `SET LOCAL default_transaction_read_only = on`).

## Secrets and config (CrewOS provides)

`~/crew/secrets` (chmod 700; override with `CREW_SECRETS_DIR`, which tests use):

| File | Holds | Used by |
|------|-------|---------|
| `crew-reader.env` | `CREW_READER_URL=postgres://crew_reader:...` (the PROD reader) | app-errors, retention-status, provider-health, board-state, data-keeper |
| `vercel.token` | a Vercel token (account-wide; the scripts are pinned to project `sportsvyn`, `prj_dnWLrT1wn34YScbMwQgtGT3WYVoE`, team `deriksilva35s-projects`) | vercel-errors, latest-deploy, cost-watch |
| `cloudflare.token` | a Cloudflare token with Zone Read + Analytics Read (the zone is looked up by name, `sportsvyn.com`) | cf-top |
| `resend.token` (optional) | a Resend API key | cost-watch (`resend_sent_mtd`; `-` without it) |
| `cfbd.token` (optional) | the CFBD key | data-keeper, only for the team-colours job (its CFB half makes one CFBD call) |

Other environment: `CREW_REPO` (the repo checkout holding `docs/crew/data-queue.md`; default the
checkout the scripts sit in, else `~/crew/worktrees/sportsvyn-main`), `CREW_DATA_DIR` (data-keeper
output, default `~/crew/data`), `CREW_JOB_TIMEOUT_MS`.

## Scripts

| Script | Args | SUMMARY | Exit 1 when |
|--------|------|---------|-------------|
| `app-errors` | `[window_min=60]` | `SUMMARY app-errors status=ok\|regression window_min=60 errors=N new_hashes=N top_source=<service\|->` | `new_hashes > 0` (a stack_hash first seen inside the window) |
| `vercel-errors` | `[window_min=60]` | `SUMMARY vercel-errors status=ok\|regression window_min=60 errors_5xx=N routes=N top_route=<path\|->` | `errors_5xx > 0` |
| `cf-top` | `[window_min=60]` | `SUMMARY cf-top status=ok window_min=60 requests=N blocked=N challenged=N top_asn=<asn\|-> top_path=<path\|->` | never (0 unless a setup error) |
| `retention-status` | none | `SUMMARY retention-status status=ok\|regression tables=N overdue=N largest=<table>:<rows>` | `overdue > 0` (tables: app_errors, push_sends, daily_guest_runs, sessions; days in watch-rules.md "retention") |
| `provider-health` | none | `SUMMARY provider-health status=ok\|regression providers=N stale=N stalest=<provider>:<minutes\|never>` | `stale > 0` (BDL, CFBD, odds, FFC, injuries; cadences in watch-rules.md "provider-health") |
| `cost-watch` | none | `SUMMARY cost-watch status=ok\|regression vercel_usd_mtd=X neon_usd_mtd=X resend_sent_mtd=N pace=ok\|over` | `pace=over` (month-to-date projected past the BUDGET line in watch-rules.md); unknown values print `-` and never count as over |
| `latest-deploy` | none | `SUMMARY latest-deploy status=ok\|regression deploy_id=<dpl_x> state=READY\|ERROR\|BUILDING commit=<sha7> created=<ISO8601>` | `state=ERROR` (production target) |
| `board-state` | none | prints one line: `locks_in:<m>`, `open` or `closed` | never; exit 2 prints nothing |
| `data-keeper` | none | `SUMMARY data-keeper status=ok\|regression job=<id> rows_before=N rows_after=N would_change=N dry_run=<path>` | the dry run's data contradicts itself |

Notes:

- **app-errors**: `errors` counts distinct error signatures (service + stack_hash) seen again in the
  window, not occurrences (the table keeps one row per signature); message text is never read.
- **vercel-errors**: reads the same request-log endpoint the Vercel CLI uses, filtered to production 5xx.
- **cf-top**: counts and ASN numbers only; client IPs are never requested.
- **cost-watch**: `neon_usd_mtd` is always `-` (Neon's API reports hours and bytes, not dollars).
- **board-state**: a PUBLIC board is a `contests` row that is opened (`opens_at <= now`), not settled
  and not locked (`locks_at` null or in the future). Leagues' private drafts, Survivor, the Daily and
  per-user entries are other tables and are not read. `locks_in:<m>` when the soonest lock is within 120 min.
- **data-keeper**: takes the top UNCHECKED job in `docs/crew/data-queue.md`, runs only its dry-run
  command (`DATABASE_URL` = the read-only reader URL; never an apply flag, and a queue entry that carries
  one is refused), writes the full output to `~/crew/data/<YYYY-MM-DD>-<job>.txt`, and prints the counts,
  10 sample rows, the file path, then `APPLY: <exact command for Derik to run by hand>`, then the SUMMARY.
  The checkout needs `npm ci` done (the job scripts import repo modules).

## The database surface

`scripts/crew-reader-grants.mjs` creates schema `crew_stats` and its views and grants the role
(`--apply` for DEV, `--prod --apply` for PROD). Views used here: `app_errors_v`, `boards_v`,
`retention_ages_v`, `provider_freshness_v` (no email, handle, IP, token, message text or payload).
