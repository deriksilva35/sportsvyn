# crew/ (SPORTSVŶN)

This folder is the source of truth for the SPORTSVŶN agent crew (CrewOS, adapter spec §3a).

- crew/agents/watcher/SOUL.md, crew/agents/data-keeper/SOUL.md, crew/agents/fixer/SOUL.md
- crew/project.yaml, crew/NOTES.md
- crew/bin/ and crew/lib/: the droplet scripts (installed under crew-sportsvyn ~/crew/bin as forced commands; contract and SUMMARY formats below)

CrewOS installs from this repo and records agents.soul_ref = path + commit SHA.
Every change to a SOUL, project.yaml or NOTES.md is a PR into this folder (required check green, Derik merges). Never edit a Drive copy.
Drive CrewOS/crews/sportsvyn/ is archived for this project (old versions in _archive/).

## The scripts

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
  values, `-` for empty or unknown). On exit 2 it is exactly
  `SUMMARY <script> status=error reason=<kind>:<host>` with kind one of `unreachable | auth | not_found | timeout`
  (a human `<script>: error: ...` line, redacted, may precede it). `<host>` names what failed: an API or DB
  hostname (port dropped to `_`), a secret file name, or a local label. Never a secret, a query string or a
  connection string. `board-state` is the exception: it prints one state line and, on exit 2, nothing at all.

  | kind | when | host |
  |---|---|---|
  | `timeout` | an HTTP/DB call's AbortSignal fired, before headers OR while the body was read; or the 9.5 s script deadline (`timeout:deadline`) | the API/DB host |
  | `unreachable` | DNS, TLS, connection refused; any HTTP status other than 401/403/404 (5xx, 429, ...); non-JSON or empty DB reply; an unexpected internal error (`unreachable:internal`); a data-keeper job script that exited non-zero (`unreachable:dry-run`) | the API/DB host |
  | `auth` | HTTP 401/403; a missing or malformed secret | the API host the token would have called (`api.vercel.com`), or `crew-reader.env` for the DB URL |
  | `not_found` | HTTP 404; bad or extra arguments (`not_found:args`); unknown script (`not_found:script`); repo checkout missing (`not_found:repo`); data-keeper queue/job refused or unparsable (`not_found:data-queue`, `not_found:dry-run-totals`) | the API host, or a local label |
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
| `retention-status` | none | `SUMMARY retention-status status=ok\|regression tables=N overdue=N largest=<table>:<rows>` never for overdue (informational: overdue counts print with `status=ok` until a pruner exists; tables: app_errors, push_sends, daily_guest_runs, sessions; 30-day rule in watch-rules.md "retention") |
| `provider-health` | none | `SUMMARY provider-health status=ok\|regression providers=N stale=N stalest=<provider>:<minutes\|never>` (or `<provider>:<endpoint>:<status>` for an auth error) | `stale > 0` (BDL, CFBD, odds, FFC; a 401 or 403 in `provider_errors_v` within 15 min also counts as stale for that provider and outranks age, e.g. `stalest=cfbd:scoreboard:401`; 429/5xx stay informational unless stale by age; injuries is excluded from the stale count until its cron is in vercel.json; cadences in watch-rules.md "provider-health") |
| `cost-watch` | none | `SUMMARY cost-watch status=ok\|regression vercel_usd_mtd=X neon_usd_mtd=X resend_sent_mtd=N pace=ok\|over\|unknown` | `pace=over`, only when the Vercel monthly figure (BUDGET line in watch-rules.md) is a known number and month-to-date projects past it; while it is `unknown`, `pace=unknown`; unknown values print `-` and never count as over |
| `latest-deploy` | none | `SUMMARY latest-deploy status=ok\|regression deploy_id=<dpl_x> state=READY\|ERROR\|BUILDING commit=<sha7> created=<ISO8601>` | `state=ERROR` (production target) |
| `board-state` | none | prints one line: `locks_in:<m>`, `open` or `closed` | never; exit 2 prints nothing |
| `data-keeper` | none | `SUMMARY data-keeper status=ok\|regression job=<id> rows_before=N rows_after=N would_change=N dry_run=<path>` | the dry run's data contradicts itself |

Notes:

- **app-errors**: `errors` counts distinct error signatures (service + stack_hash) seen again in the
  window, not occurrences (the table keeps one row per signature); message text is never read.
- **vercel-errors**: reads the same request-log endpoint the Vercel CLI uses, filtered to production 5xx.
- **cost-watch**: `neon_usd_mtd` is always `-`: Neon bills compute hours, not dollars (its API reports hours and bytes). `vercel_usd_month` (Derik's plan line item, `<VERCEL_MONTHLY_USD>`) is `unknown` until he sets it; until then `vercel_usd_mtd` prints and `pace=unknown`, never `over`. Billing charges are a 13 MB+ JSON-lines export that grows through the month (about 5.5 s to first byte); it is streamed line by line with an 8 s budget, and if it cannot be read in time (timeout, 403/404, unreachable) the field prints `-`, `pace=unknown`, the script stays `status=ok` exit 0, and a detail line says `vercel billing unavailable: <kind>:api.vercel.com`. A failed Resend call likewise leaves `resend_sent_mtd` `-`. Only a missing `vercel.token` is exit 2 (`auth:api.vercel.com`).
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
`retention_ages_v`, `provider_freshness_v`, `provider_errors_v`, `live_matches_v` (no email, handle, IP, token, message text or payload).

<!-- fri-2 proof: a crew/README.md-only change runs the full suite. -->
