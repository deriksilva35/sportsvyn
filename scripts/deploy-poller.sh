#!/usr/bin/env bash
# scripts/deploy-poller.sh - pin the droplet's services to ONE commit (sun-12 item 7).
#
#   scripts/deploy-poller.sh <commit-or-ref> [--force] [--install-units] [--npm-ci] [--dry-run] [--keep N]
#   scripts/deploy-poller.sh --rollback [--dry-run]
#
# The live poller, the daily tick and the MLB advance all run from
#   ~/deploy/sportsvyn/current -> releases/<sha>
# never from the working checkout (~/projects/sportsvyn), so a restart ships the
# commit that was DEPLOYED, not whatever happens to be checked out that minute.
# Runbook, first-time install and journal reading: docs/ops/poller-deploy.md.
#
# WHAT A DEPLOY DOES, in order (nothing before step 6 touches a running service):
#   1. resolve the ref to a sha in the main repo; refuse unless it is on
#      origin/main (after a fetch), unless --force
#   2. releases/<sha>: `git worktree add --detach` from the main repo, locked
#      (reused as-is if it already exists and is complete)
#   3. node_modules: a hardlink copy (cp -al) of the main tree's when the commit's
#      package.json dependencies are identical to the main tree's, else
#      `npm ci --omit=dev` from the commit's lockfile, memory-capped
#   4. .env.local: a symlink to the main tree's (one copy of every secret)
#   5. smoke: `node --check` on every entrypoint a unit starts; the pinned node
#      binary in the unit file exists
#   6. atomic switch: current.tmp -> mv -T over current; previous <- old current
#   7. restart sportsvyn-live-poller (the oneshots pick up `current` on their next
#      fire; there is nothing of theirs to restart)
#   8. proof: the poller's own "live-poller starting: ... head=<sha>" line from the
#      journal since the restart; a different head is a failed deploy (exit 1)
#   9. prune: keep the newest --keep releases (3), never current or previous,
#      never one a running process has as its cwd
#
# Environment overrides (the test harness uses all of them; on the droplet the
# defaults are right):
#   SV_MAIN         the main checkout          (default ~/projects/sportsvyn)
#   SV_DEPLOY_ROOT  the deploy folder          (default ~/deploy/sportsvyn)
#   SV_UNIT_DIR     user unit directory        (default ~/.config/systemd/user)
#   SV_NODE         node for the helper        (default: node on PATH, else the unit's pinned node)
#   SV_PROOF_SECS   seconds to wait for proof  (default 45)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/../lib/ops/deployPoller.mjs"
MAIN="${SV_MAIN:-$HOME/projects/sportsvyn}"
ROOT="${SV_DEPLOY_ROOT:-$HOME/deploy/sportsvyn}"
UNIT_DIR="${SV_UNIT_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"
PROOF_SECS="${SV_PROOF_SECS:-45}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
POLLER=sportsvyn-live-poller.service
PINNED_NODE="$HOME/.nvm/versions/node/v22.23.1/bin/node"
NODE="${SV_NODE:-$(command -v node || echo "$PINNED_NODE")}"
MARKER=node_modules/.sportsvyn-release
# unit files, relative to a release (the repo is their source of truth)
UNIT_FILES=(
  services/live-poller/systemd/sportsvyn-live-poller.service
  services/daily-tick/systemd/sportsvyn-daily-tick.service
  services/daily-tick/systemd/sportsvyn-daily-tick.timer
  services/mlb-advance/systemd/sportsvyn-mlb-advance@.service
  services/mlb-advance/systemd/sportsvyn-mlb-advance.timer
)
ENTRYPOINTS=(services/_preload/prod-db.mjs services/live-poller/index.mjs services/daily-tick/index.mjs services/mlb-advance/index.mjs)

say()  { printf '[deploy-poller] %s\n' "$*"; }
die()  { printf '[deploy-poller] REFUSED: %s\n' "$*" >&2; exit 1; }
run()  { if [[ $DRY_RUN == 1 ]]; then say "would: $*"; else "$@"; fi; }

# --- 0. arguments (parsed by the tested helper, not by hand) -----------------
ARGS_OUT="$("$NODE" "$HELPER" args -- "$@")" || exit $?
REF='' ROLLBACK=0 FORCE=0 INSTALL_UNITS=0 NPM_CI=0 DRY_RUN=0 KEEP=3
while IFS='=' read -r k v; do
  case "$k" in
    REF) REF=$v ;; ROLLBACK) ROLLBACK=$v ;; FORCE) FORCE=$v ;; INSTALL_UNITS) INSTALL_UNITS=$v ;;
    NPM_CI) NPM_CI=$v ;; DRY_RUN) DRY_RUN=$v ;; KEEP) KEEP=$v ;;
  esac
done <<<"$ARGS_OUT"

[[ -d "$MAIN/.git" ]] || die "main repo not found at $MAIN"
[[ -f "$MAIN/.env.local" ]] || die "$MAIN/.env.local is missing - the units read it"

if [[ $DRY_RUN == 0 ]]; then
  mkdir -p "$ROOT/releases"
  exec 9>"$ROOT/.deploy.lock"
  flock -n 9 || die "another deploy holds $ROOT/.deploy.lock"
fi

sha_of_link() { local t; t="$(readlink "$1" 2>/dev/null || true)"; [[ -n $t ]] && basename "$t" || true; }
release_ready() { [[ -f "$ROOT/releases/$1/$MARKER" ]] && [[ "$(git -C "$ROOT/releases/$1" rev-parse HEAD 2>/dev/null)" == "$1" ]]; }

# Atomic: a fresh symlink renamed over the old one (rename(2)); `ln -sfn` is an
# unlink then a create, with a window where `current` does not exist.
switch_link() { # name sha
  local tmp="$ROOT/.$1.tmp.$$"
  ln -s "releases/$2" "$tmp"
  mv -T "$tmp" "$ROOT/$1"
}

restart_and_prove() { # sha
  local sha=$1 since out rc i
  since=$(date +%s)
  run systemctl --user restart "$POLLER"
  [[ $DRY_RUN == 1 ]] && return 0
  for ((i = 0; i < PROOF_SECS; i++)); do
    set +e
    out="$(journalctl --user -u "$POLLER" --since "@$since" -o short-iso --no-pager 2>/dev/null | "$NODE" "$HELPER" proof "$sha")"
    rc=$?
    set -e
    if [[ $rc == 0 ]]; then say "PROOF $out"; break; fi
    if [[ $rc == 1 ]]; then say "WRONG HEAD: $out"; say "roll back with: scripts/deploy-poller.sh --rollback"; exit 1; fi
    sleep 1
  done
  [[ $rc == 0 ]] || { say "NO PROOF in ${PROOF_SECS}s: no 'live-poller starting' line since the restart"; say "check: journalctl --user -u $POLLER -n 50; roll back with --rollback"; exit 1; }
  systemctl --user is-active --quiet "$POLLER" || { say "$POLLER is not active after the restart"; exit 1; }
  say "$POLLER active, running ${sha:0:12} from $(readlink -f "$ROOT/current")"
}

check_installed_units() { # rel
  if [[ $INSTALL_UNITS == 1 ]]; then
    local f bak="$ROOT/unit-backup/$(date -u +%Y%m%dT%H%M%SZ)"
    # The units being replaced are kept, so the very first install can be undone
    # by copying them back (docs/ops/poller-deploy.md, "Undo the first install").
    run mkdir -p "$bak" "$UNIT_DIR"
    for f in "${UNIT_FILES[@]}"; do
      [[ -f "$UNIT_DIR/$(basename "$f")" ]] && run cp -p "$UNIT_DIR/$(basename "$f")" "$bak/"
      run install -m 0644 "$1/$f" "$UNIT_DIR/$(basename "$f")"
    done
    [[ $DRY_RUN == 1 ]] || say "previous unit files saved in $bak"
    run systemctl --user daemon-reload
    [[ $DRY_RUN == 1 ]] || say "units installed from ${1##*/} and daemon-reloaded"
    return 0
  fi
  local f
  for f in "${UNIT_FILES[@]}"; do
    [[ -f "$1/$f" ]] || continue
    cmp -s "$1/$f" "$UNIT_DIR/$(basename "$f")" || say "WARNING: installed $(basename "$f") differs from the release's - rerun with --install-units to apply it"
  done
  return 0
}

# --- rollback ----------------------------------------------------------------
if [[ $ROLLBACK == 1 ]]; then
  CUR="$(sha_of_link "$ROOT/current")"; PREV="$(sha_of_link "$ROOT/previous")"
  [[ -n $PREV ]] || die "no previous release recorded at $ROOT/previous"
  release_ready "$PREV" || die "previous release $PREV is missing or incomplete"
  say "rollback: current ${CUR:0:12} -> ${PREV:0:12}"
  if [[ $DRY_RUN == 0 ]]; then
    switch_link current "$PREV"
    [[ -n $CUR ]] && switch_link previous "$CUR"
    echo "$PREV" >>"$ROOT/history"
  fi
  restart_and_prove "$PREV"
  exit 0
fi

# --- 1. resolve, and refuse what is not on origin/main ------------------------
git -C "$MAIN" fetch --quiet origin main || die "git fetch origin main failed"
SHA="$(git -C "$MAIN" rev-parse --verify --quiet "${REF}^{commit}")" || die "unknown ref: $REF"
if ! git -C "$MAIN" merge-base --is-ancestor "$SHA" origin/main; then
  [[ $FORCE == 1 ]] || die "${SHA:0:12} is not on origin/main (use --force to deploy it anyway)"
  say "WARNING: ${SHA:0:12} is NOT on origin/main - deploying because of --force"
fi
# Before building anything: units that still point at the working checkout
# would make this whole deploy a no-op that looks like a success.
if [[ $INSTALL_UNITS == 0 ]] && ! grep -q 'deploy/sportsvyn/current' "$UNIT_DIR/sportsvyn-live-poller.service" 2>/dev/null; then
  WHY="the installed $POLLER still runs from the working checkout; the first deploy needs --install-units (docs/ops/poller-deploy.md)"
  if [[ $DRY_RUN == 1 ]]; then say "would REFUSE: $WHY"; else die "$WHY"; fi
fi
REL="$ROOT/releases/$SHA"
CUR="$(sha_of_link "$ROOT/current")"
say "deploy ${SHA:0:12} ($(git -C "$MAIN" log -1 --format=%s "$SHA" | cut -c1-70)); current is ${CUR:-none}"

# --- 2-5. build the release (or reuse a complete one) -------------------------
if release_ready "$SHA"; then
  say "release ${SHA:0:12} already built - reusing it"
else
  if [[ -e $REL ]]; then
    say "incomplete release at $REL - rebuilding"
    run git -C "$MAIN" worktree unlock "$REL" 2>/dev/null || true
    run git -C "$MAIN" worktree remove --force "$REL" 2>/dev/null || run rm -rf "$REL"
  fi
  run git -C "$MAIN" worktree prune
  run git -C "$MAIN" worktree add --detach --quiet "$REL" "$SHA"
  run git -C "$MAIN" worktree lock --reason "sportsvyn deploy release (scripts/deploy-poller.sh)" "$REL"

  PKG_TMP="$(mktemp)"; trap 'rm -f "$PKG_TMP"' EXIT
  git -C "$MAIN" show "$SHA:package.json" >"$PKG_TMP"
  NM_OUT="$("$NODE" "$HELPER" deps "$PKG_TMP" "$MAIN/package.json" "$NPM_CI")"
  NM_PLAN="$(sed -n 's/^NM_PLAN=//p' <<<"$NM_OUT")"; NM_REASON="$(sed -n 's/^NM_REASON=//p' <<<"$NM_OUT")"
  say "node_modules: $NM_PLAN ($NM_REASON)"
  if [[ $NM_PLAN == hardlink ]]; then
    [[ -d "$MAIN/node_modules" ]] || die "$MAIN/node_modules is missing"
    # Hardlinks, not copies: ~30k inodes, no extra disk, a second or two. npm
    # replaces files rather than editing them in place, so a later install in
    # the main tree leaves this release's links pointing at the old content.
    run cp -al "$MAIN/node_modules" "$REL/node_modules"
  else
    # The commit's lockfile is the Mac one (the droplet's Linux lockfile is never
    # committed). npm ci resolves the linux-x64 optional binaries from it; the
    # heap cap and nice keep it from crowding the 8 GB box while the poller runs.
    if [[ $DRY_RUN == 1 ]]; then say "would: npm ci --omit=dev in $REL"
    else
      (cd "$REL" && nice -n 10 env NODE_OPTIONS=--max-old-space-size=1024 npm ci --omit=dev --no-audit --no-fund --loglevel=warn) \
        || die "npm ci failed in $REL; current is unchanged. If the main tree is on this commit, 'npm install' there and redeploy (hardlink path)"
    fi
  fi
  run ln -sfn "$MAIN/.env.local" "$REL/.env.local"

  if [[ $DRY_RUN == 0 ]]; then
    for e in "${ENTRYPOINTS[@]}"; do "$NODE" --check "$REL/$e" || die "node --check failed: $e"; done
    date -u +%FT%TZ >"$REL/$MARKER"
  fi
fi

if [[ $DRY_RUN == 0 ]]; then
  NODE_BIN="$(sed -n 's/^ExecStart=\([^ ]*\).*/\1/p' "$REL/services/live-poller/systemd/sportsvyn-live-poller.service" | sed "s#%h#$HOME#")"
  [[ -x $NODE_BIN ]] || die "the unit's pinned node ($NODE_BIN) does not exist - fix ExecStart first"
fi
check_installed_units "$REL"

# --- 6. atomic switch ---------------------------------------------------------
if [[ $CUR == "$SHA" ]]; then
  say "current already is ${SHA:0:12} - restarting only"
elif [[ $DRY_RUN == 0 ]]; then
  switch_link current "$SHA"
  [[ -n $CUR ]] && switch_link previous "$CUR"
  echo "$SHA" >>"$ROOT/history"
  say "current -> releases/${SHA:0:12}${CUR:+ (previous -> ${CUR:0:12})}"
else
  say "would: current -> releases/$SHA, previous -> ${CUR:-none}"
fi

# --- 7-8. restart and prove ---------------------------------------------------
restart_and_prove "$SHA"

# --- 9. prune -----------------------------------------------------------------
[[ $DRY_RUN == 1 ]] && exit 0
PREV="$(sha_of_link "$ROOT/previous")"
mapfile -t PRESENT < <(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
mapfile -t GONE < <("$NODE" "$HELPER" prune "$ROOT/history" "$SHA" "$PREV" "$KEEP" "${PRESENT[@]}")
for old in "${GONE[@]}"; do
  [[ -n $old ]] || continue
  dir="$(readlink -f "$ROOT/releases/$old")"
  if for p in /proc/[0-9]*/cwd; do readlink "$p" 2>/dev/null; done | grep -q -e "^$dir\$" -e "^$dir/"; then
    say "keeping ${old:0:12}: a running process has it as its cwd"; continue
  fi
  git -C "$MAIN" worktree unlock "$dir" 2>/dev/null || true
  git -C "$MAIN" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
  say "pruned ${old:0:12}"
done
git -C "$MAIN" worktree prune
say "done: current=${SHA:0:12} previous=${PREV:0:12} releases=$(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)"
