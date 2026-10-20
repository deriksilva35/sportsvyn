#!/usr/bin/env bash
# scripts/suite.sh - THE full suite, under the host-wide suite lock.
# Several Claude Code sessions share this host - and since 20 Oct the CrewOS
# GitHub runner too (.github/workflows/tests.yml). Two full suites at once fight
# over database fixtures and RAM, so every suite on this host takes ONE lock.
#
#   scripts/suite.sh [extra node --test args]     (also: npm test)
#   SV_SUITE_ENV=crew scripts/suite.sh            the crew's gate (below)
#
# THE LOCK. /run/lock/sportsvyn-suite/suite.lock - the file the CI job flocks -
# whenever its directory exists and is writable (group sportsvyn); else the old
# ~/.sportsvyn-suite.lock, so a host without the crew's directory still works.
#
# TWO ENVIRONMENTS.
#   default  the droplet gate: sources .env.local (DEV database, live keys).
#   crew     SV_SUITE_ENV=crew: runs ONLY on the environment it was handed (the
#            crew's filtered env, the "ci" Neon branch) and refuses, before the
#            lock, when it could see PROD or DEV:
#              - a .env.local in the tree: ~100 test files load it themselves
#                (fill-missing), which would hand PROD_DATABASE_URL and the live
#                keys to the run whatever the crew filtered. Crew runs use a
#                checkout without one, as the GitHub runner does;
#              - PROD_DATABASE_URL set at all;
#              - DATABASE_URL unset, or pointing at DEV or PROD.
#
# Test hooks: SV_SUITE_CMD (replaces the node --test command), SV_SUITE_LOCK
# (lock path), SV_SUITE_WAIT (seconds to wait for the lock, default 600),
# SV_SUITE_DOTENV (the env file, default <repo>/.env.local).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARED_LOCK=/run/lock/sportsvyn-suite/suite.lock
if [ -n "${SV_SUITE_LOCK:-}" ]; then LOCK="$SV_SUITE_LOCK"
elif [ -d "${SHARED_LOCK%/*}" ] && [ -w "${SHARED_LOCK%/*}" ]; then LOCK="$SHARED_LOCK"
else LOCK="$HOME/.sportsvyn-suite.lock"; fi
WHO="$LOCK.who"
WAIT="${SV_SUITE_WAIT:-600}"
DOTENV="${SV_SUITE_DOTENV:-$ROOT/.env.local}"
MODE="${SV_SUITE_ENV:-default}"
# Group-writable: the runner (gh-runner) and the sessions (derik) share the files.
umask 002
cd "$ROOT" || exit 1

refuse() { echo "suite refused (crew): $1" >&2; exit 2; }
if [ "$MODE" = crew ]; then
  [ -e "$DOTENV" ] && refuse "$DOTENV exists - test files load it themselves and would see PROD and the live keys. Run from a checkout without one."
  [ -n "${PROD_DATABASE_URL:-}" ] && refuse "PROD_DATABASE_URL is set in the crew env."
  host="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).host)}catch{console.log('')}")"
  [ -z "$host" ] && refuse "DATABASE_URL is not set (the crew runs on the 'ci' Neon branch)."
  case "$host" in ep-rough-mouse-*|ep-winter-dawn-*) refuse "DATABASE_URL points at DEV or PROD ($host).";; esac
elif [ "$MODE" != default ]; then
  echo "SV_SUITE_ENV must be 'crew' or unset (got '$MODE')" >&2; exit 2
fi

exec 9>>"$LOCK"
if ! flock -n 9; then
  holder="$(cat "$WHO" 2>/dev/null || echo 'unknown holder')"
  echo "suite busy: $holder - waiting up to $((WAIT / 60)) min (${WAIT}s)"
  if ! flock -w "$WAIT" 9; then
    echo "suite busy: $(cat "$WHO" 2>/dev/null || echo 'unknown holder')"
    exit 1
  fi
fi
echo "$(id -un)@$(hostname) pid $$ $ROOT since $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WHO"
trap 'rm -f "$WHO"' EXIT

START=$(date +%s)
if [ -n "${SV_SUITE_CMD:-}" ]; then
  bash -c "$SV_SUITE_CMD" -- "$@"
  code=$?
else
  # The droplet gate sources the env file; the crew runs on what it was handed.
  if [ "$MODE" = default ]; then set -a && . "$DOTENV" && set +a; fi
  # shellcheck disable=SC2046
  node --test "$@" $(git ls-files '*.test.mjs')
  code=$?
fi
echo "suite wall-clock: $(( $(date +%s) - START ))s"
exit "$code"
