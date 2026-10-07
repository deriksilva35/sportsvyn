#!/usr/bin/env bash
# scripts/suite.sh - THE full suite, under the host-wide suite lock.
# Several Claude Code sessions share this host; two full suites at once fight
# over DEV fixtures and RAM. One at a time, via flock on ~/.sportsvyn-suite.lock.
#
#   scripts/suite.sh [extra node --test args]     (also: npm test)
#
# Test hooks: SV_SUITE_CMD (replaces the node --test command), SV_SUITE_LOCK
# (lock path), SV_SUITE_WAIT (seconds to wait for the lock, default 600).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${SV_SUITE_LOCK:-$HOME/.sportsvyn-suite.lock}"
WHO="$LOCK.who"
WAIT="${SV_SUITE_WAIT:-600}"
cd "$ROOT" || exit 1

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
  set -a && . ./.env.local && set +a
  # shellcheck disable=SC2046
  node --test "$@" $(git ls-files '*.test.mjs')
  code=$?
fi
echo "suite wall-clock: $(( $(date +%s) - START ))s"
exit "$code"
