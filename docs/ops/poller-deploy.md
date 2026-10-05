# Droplet services: deploy, restart, rollback (sun-12 item 7)

> Ruling (Derik, sun-12 item 7): "Live poller runs from its own deploy folder
> pinned to a commit, with a memory cap; restart procedure documented."

Three systemd **user** units on the droplet run Sportsvyn code against PROD:

| unit | kind | what starts it |
|---|---|---|
| `sportsvyn-live-poller.service` | long-running loop (30 s) | enabled at boot; restarted by a deploy |
| `sportsvyn-daily-tick.service` | oneshot | `sportsvyn-daily-tick.timer`, every 5 min |
| `sportsvyn-mlb-advance@.service` | oneshot | `sportsvyn-mlb-advance.timer` (10:00Z, `@timer`) and the poller's day-over kick (`@event`, lib/mlb/advanceKick.js) |

All three run from **`~/deploy/sportsvyn/current`**, never from the working
checkout `~/projects/sportsvyn` (which has 155 worktrees around it and is
whatever somebody last checked out). Before this, a restart shipped whatever
was checked out in that folder.

```
~/deploy/sportsvyn/
  current   -> releases/<sha>      what the units run
  previous  -> releases/<sha>      what --rollback goes back to
  history                          one sha per switch, oldest first
  releases/<sha>/                  detached, locked git worktree of the main repo
    node_modules/                  hardlinks into ~/projects/sportsvyn/node_modules (or npm ci)
    .env.local -> ~/projects/sportsvyn/.env.local
  unit-backup/<UTC time>/          unit files replaced by an --install-units run
  .deploy.lock                     flock: one deploy at a time
```

The unit files are tracked next to their services and are installed **byte for
byte** (no sed step any more):

- `services/live-poller/systemd/sportsvyn-live-poller.service`
- `services/daily-tick/systemd/sportsvyn-daily-tick.service` + `.timer`
- `services/mlb-advance/systemd/sportsvyn-mlb-advance@.service` + `.timer`

`services/deployUnits.test.mjs` pins the deploy path, the env file and the memory
caps in every one of them.

## Deploy (after every merge that touches anything the services import)

```sh
cd ~/projects/sportsvyn && git pull --ff-only     # keeps the main tree's node_modules in step
scripts/deploy-poller.sh origin/main --dry-run    # optional: print the plan
scripts/deploy-poller.sh origin/main
```

What it does, in order (nothing before step 6 touches a running service):

1. fetches origin and resolves the ref to a sha; **refuses** a commit that is not
   on `origin/main` unless `--force`
2. `git worktree add --detach releases/<sha> <sha>` from the main repo, then
   `git worktree lock` (reuses a complete release that already exists)
3. node_modules: `cp -al` from the main tree when the commit's package.json
   dependencies equal the main tree's; otherwise `npm ci --omit=dev` (see below)
4. symlinks `.env.local` from the main tree
5. `node --check` on every entrypoint a unit starts, and checks the unit's pinned
   node binary exists
5b. **boot check** (`lib/ops/bootCheck.mjs`, see below): every entry is started
   from the release, with the unit's node, exactly as its unit starts it plus
   `--boot-check`. Any failure exits 1 with `BOOT CHECK FAILED` and the entry's
   output; `current` has NOT moved and nothing was restarted. Runs on every
   deploy, a reused release included; a commit older than the check is deployed
   with a `predates the boot check` warning.
6. atomic switch: a new symlink renamed over `current` (`mv -T`, one rename(2));
   `previous` <- the old `current`
7. `systemctl --user restart sportsvyn-live-poller`
8. **proof**: waits up to 45 s for the poller's own starting line since the
   restart and prints it:
   ```
   [deploy-poller] PROOF 2026-10-04T12:57:31+00:00 considered-cc sportsvyn-live[2153352]: ... live-poller starting: pid=2153352 head=660fcb1 leagues=cfb,nfl,mlb,nba
   ```
   A different `head=` exits 1 ("WRONG HEAD"); no line in 45 s exits 1 ("NO PROOF").
   Either way `current` has ALREADY switched - run `--rollback`.
9. prunes to the newest 3 releases, never `current` or `previous`, never one a
   running process has as its cwd (a 15-minute advance run started just before)

The oneshots are not restarted: systemd resolves `current` each time one starts,
so the next tick / the next advance runs the new release.

Flags: `--force` (not on origin/main), `--install-units` (copy the release's unit
files into `~/.config/systemd/user`, back up the old ones, `daemon-reload`),
`--npm-ci` (never hardlink), `--keep N`, `--dry-run`.

If a unit file changed in the commit, a plain deploy prints
`WARNING: installed <unit> differs from the release's` - rerun with `--install-units`.

## Restart (same commit)

```sh
systemctl --user restart sportsvyn-live-poller     # restarts the SAME release; ships nothing
scripts/deploy-poller.sh "$(basename "$(readlink ~/deploy/sportsvyn/current)")"   # same, with the proof line
```

## Rollback

```sh
scripts/deploy-poller.sh --rollback               # current <-> previous, restart, proof
```

A second `--rollback` undoes the first. To go further back, deploy the sha
explicitly (`scripts/deploy-poller.sh <sha>`; anything already on origin/main is
allowed, and a kept release is reused without a rebuild).

## Check

```sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)
readlink ~/deploy/sportsvyn/current ~/deploy/sportsvyn/previous     # the two pinned shas
readlink /proc/$(systemctl --user show -p MainPID --value sportsvyn-live-poller)/cwd   # what the poller really runs
systemctl --user show sportsvyn-live-poller -p MemoryCurrent,MemoryPeak,MemoryHigh,MemoryMax,NRestarts,ActiveState
systemctl --user list-timers 'sportsvyn*'
git -C ~/projects/sportsvyn worktree list | grep deploy/sportsvyn  # releases, all "locked"
```

## Reading the journal

```sh
journalctl --user -u sportsvyn-live-poller -f                                   # live
journalctl --user -u sportsvyn-live-poller -o cat | grep 'live-poller starting' | tail -5   # every start, with head=
journalctl --user -u sportsvyn-live-poller -o cat | grep -E 'memory peak|oom|Killed'        # caps hit?
journalctl --user -u sportsvyn-daily-tick -n 20
journalctl --user -u 'sportsvyn-mlb-advance@*' -o cat | grep '\[mlb-advance\]'
```

Each stop logs `Consumed ... CPU time, <N>M memory peak` - the number the caps
were sized from. An OOM kill at `MemoryMax` shows as
`sportsvyn-live-poller.service: A process of this unit has been killed by the OOM killer`
followed by an automatic restart.

## Why it is built this way

**A detached git worktree, not `git archive`.** The poller proves what it runs by
logging `head=$(git rev-parse --short HEAD)` from its working directory
(services/live-poller/index.mjs). An archive has no `.git`, so the proof the
ruling asks for would read `head=unknown`; a worktree answers natively with no
code change. It also costs nothing: it shares the main repo's object store, and
its HEAD keeps the commit reachable through any `git gc`. It is `--detach`ed (no
branch to move) and `git worktree lock`ed (a `git worktree prune` from some other
relay cannot drop it). The units' `ProtectHome=read-only` means the service
itself cannot write into it either.

**node_modules: hardlinks from the main tree when the dependencies match, else
`npm ci --omit=dev`.** The comparison is on package.json's dependency fields,
NOT the lockfile: the droplet's lockfile is regenerated on Linux and never
committed, so it never equals the commit's (Mac) lockfile and a lockfile test
would never take the fast path. `cp -al` of ~30k files is a second or two, uses
no disk, and needs no network or RAM. npm replaces files rather than editing
them in place, so a later `npm install` in the main tree leaves a release's links
on the old content. When dependencies differ, `npm ci --omit=dev` runs inside the
release from the commit's own lockfile, under `nice` with a 1 GB node heap cap so
it does not crowd the 8 GB box while the poller and the Claude sessions run; if
it fails, `current` is untouched - `npm install` in the main tree (once it is on
that commit) and redeploy to take the hardlink path instead.

**EnvironmentFile is the main tree's `.env.local`, not a copy in ~/deploy.** A
second copy of a credential is a second thing to rotate and a second thing to
leak, and the forgotten one is always the copy. The cost: an edit to `.env.local`
reaches a service on its next start, deployed or not - which is exactly what a
rotated key needs. Each release also gets a `.env.local` symlink for hand-run
scripts that `. ./.env.local` from the cwd; it is gitignored, so it never reaches git.

**Memory caps, from measured usage.** The poller runs at 37-46 MB and the highest
`memory peak` any run has logged is 93 MB. `MemoryHigh=384M` (reclaim pressure
starts) / `MemoryMax=512M` (OOM-kill and restart) / `MemorySwapMax=128M` (the wall
cannot be walked around through swap). The MLB advance spawns the import as a
child in the same cgroup: `768M / 1G / 256M`. The daily tick: `384M / 512M / 128M`.
The memory controller is delegated to the user manager on this droplet
(`cgroup.controllers: cpu memory pids`), so the caps are enforced.

**Restart=always, backing off, never giving up.** Every real stop (crash, dead loop,
OOM kill, an unexpected clean exit) restarts, while a deliberate
`systemctl --user stop` stays stopped (systemd never restarts a unit it was told to stop). `RestartSec=10` growing over
`RestartSteps=5` to `RestartMaxDelaySec=5min`; `StartLimitIntervalSec=0` in
`[Unit]` so systemd never gives up (a poller systemd stopped restarting is a
poller silently off all slate).

**advanceKick needed no change.** The transient `systemd-run` unit only runs
`systemctl --user start sportsvyn-mlb-advance@event.service`; the started unit
owns its `WorkingDirectory`, which is the deploy folder. A test pins both halves.

## First-time install (the parent's apply procedure)

Pick a quiet window: no live game in the poller's leagues, not within a few
minutes of 10:00Z (the advance timer), and no MLB postseason game about to go final
(the @event kick fires 5 min after the day's last final).

```sh
cd ~/projects/sportsvyn
git pull --ff-only                                        # main tree has the script + units
export XDG_RUNTIME_DIR=/run/user/$(id -u)
mkdir -p ~/deploy/sportsvyn && cp -a ~/.config/systemd/user ~/deploy/sportsvyn/units-before-first-install

scripts/deploy-poller.sh origin/main --install-units --dry-run   # read the plan
scripts/deploy-poller.sh origin/main --install-units             # build, install units, switch, restart, PROOF
```

Then check:

```sh
readlink /proc/$(systemctl --user show -p MainPID --value sportsvyn-live-poller)/cwd   # .../deploy/sportsvyn/releases/<sha>
systemctl --user show sportsvyn-live-poller -p MemoryMax,MemoryHigh,MemorySwapMax,Restart  # 536870912 / 402653184 / 134217728 / always
systemctl --user cat sportsvyn-daily-tick.service 'sportsvyn-mlb-advance@timer.service' | grep WorkingDirectory
systemctl --user list-timers 'sportsvyn*'                 # both timers still scheduled
journalctl --user -u sportsvyn-daily-tick -n 5 -f         # the next tick (<= 5 min) succeeds from the release
```

**Downtime: about 1-3 seconds of poller**, once. Building the release, installing
the unit files and `daemon-reload` happen before the restart and interrupt
nothing (a reload does not touch a running service). The restart itself is a stop
plus a start (the journal shows `Stopping`/`Started` in the same second) and the
poller's first poll follows within a second or two, so at most one 30-second poll
tick is late. The daily tick and the advance have no downtime: their next run
simply starts in the release.

**Undo the first install** (back to running from the checkout):

```sh
cp -a ~/deploy/sportsvyn/units-before-first-install/sportsvyn-* ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart sportsvyn-live-poller
```

(`--install-units` also saves every file it replaces under
`~/deploy/sportsvyn/unit-backup/<UTC time>/`.)

## Things to know

- **An nvm upgrade is a unit edit.** ExecStart pins
  `%h/.nvm/versions/node/v22.23.1/bin/node`; the deploy refuses if that binary is
  missing. Change it in the three unit files, merge, deploy with `--install-units`.
- **Hand-run scripts still use the checkout.** `node scripts/...` from
  ~/projects/sportsvyn (the CLAUDE.md MLB-postseason hand runs, backfills) runs
  whatever is checked out there; only the systemd units are pinned.
- **The script operates on `~/projects/sportsvyn`** regardless of where it is
  invoked from (override with `SV_MAIN`; `SV_DEPLOY_ROOT`, `SV_UNIT_DIR` likewise -
  the test harness, scripts/deploy-poller.test.mjs, runs it entirely in a temp
  directory with stub `systemctl`/`journalctl`/`npm`).

## Boot check (mon-3 item 2)

**Why.** On 5 Oct a merge put `const cfbKick = createKickThrottle({ ... log ... })`
above `const log = ...` in `services/live-poller/index.mjs`. That is a TDZ
`ReferenceError` the moment the module evaluates - but it parses, so `node --check`
passed, and no test imports an entry file (importing one starts it), so the full
suite passed. The poller restart-looped after the deploy (fixed in ee6ccd2).

**What.** Each entry calls `await bootCheckGate(name, lazy)` at the last point
before its first connection, loop, lock or write:

| entry | gate is placed | lazy modules it also loads |
|---|---|---|
| `services/live-poller/index.mjs` | after every top-level object (LEAGUES, cfbKick, ...), before the `starting` line and the loops | `lib/pollers/alerts.js` |
| `services/daily-tick/index.mjs` | after its imports, before `tick()` | - |
| `services/mlb-advance/index.mjs` | after the PROD guard, before the lock and the import | `lib/db.js`, `lib/pollers/alerts.js`, `lib/push/notify.js`, `lib/admin/gate.js` |

Without `--boot-check` on argv the gate returns and nothing changes. With it, the
gate prints a loud banner, loads the lazy modules, prints
`[boot-check] <name> ok` and exits 0.

**Why an explicit mode, not "run it for 10 s with a fake DB".** A real start
with a fake DB would retry and log connection errors - indistinguishable from a
crash by output, and a timer is a guess (a slow import and a healthy loop look the
same). The gate is deterministic, needs no network, and takes ~0.3 s for all three.

**Why it cannot switch on in production.** It is an **argv** flag only: the units
read `.env.local` through `EnvironmentFile`, so an env-var switch could be set
there by accident and turn the poller into a process that exits 0 on every start.
argv comes only from `ExecStart`, and `services/bootCheck.test.mjs` asserts no unit
passes `--boot-check`. In boot-check mode the gate also **refuses** (exit 1) any
`DATABASE_URL` other than the stub `boot-check.invalid` host.

**Hermetic.** The runner (`runBootCheck` / `node lib/ops/bootCheck.mjs`) spawns
`node --import ./services/_preload/prod-db.mjs <entry> --boot-check` with a
scrubbed environment: `PATH`, `HOME`, a stub `PROD_DATABASE_URL`
(`postgres://...@boot-check.invalid`), a stub `RESEND_API_KEY`. No real secret is
passed through. It fails an entry on a non-zero exit, a timeout, an error name
(`ReferenceError`, `SyntaxError`, `TypeError`, module-not-found ...) in the output,
or a missing `ok` line (an entry that exits 0 without reaching its gate proves
nothing).

**By hand**, from a release or a checkout:

```sh
cd ~/deploy/sportsvyn/current && node lib/ops/bootCheck.mjs
# [boot-check] live-poller: ok
# [boot-check] daily-tick: ok
# [boot-check] mlb-advance: ok
```

**In the suite.** `services/bootCheck.test.mjs` runs all three entries (~1.5 s),
plus a negative control that replays the 5 Oct order (the real poller source with
`log` moved below `cfbKick`, written to `test-tmp/`) and must fail with
`ReferenceError: Cannot access 'log' before initialization`.
`scripts/deploy-poller.test.mjs` deploys a sandbox release with the same TDZ and
asserts the deploy is refused with `current` and the poller untouched.

**A new unit / entry** must be added to `ENTRIES` in `lib/ops/bootCheck.mjs` and
call `bootCheckGate`; the suite fails if a unit's `ExecStart` names an entry that
`ENTRIES` does not check.

**Not covered:** `scripts/mlb-postseason-import.mjs`, which mlb-advance spawns as
a child process - it is not booted here.
`--rollback` does not boot-check (it returns to a release that was running).
