#!/usr/bin/env bash
# scripts/droplet-deploy.sh - pull main and restart the droplet's services.
#
# WHY THIS EXISTS. The droplet's two long-lived services (live-poller,
# daily-tick) load their modules at process start. A merge to main changes
# the files on disk and changes NOTHING about what is running - so on
# 5 Sep the team-name prefix commit 89b168e sat on disk, unused, for
# twenty-two hours while the poller kept sending the old bare-word text.
# Nothing was broken; nothing had been restarted.
#
# THE RULE THIS ENFORCES: a merge to main that touches services/ or
# lib/push/ is followed by this script. It is not automatic - a deploy that
# restarts a live poller mid-slate is its own hazard - but it is one
# command, and it prints the SHA each service is actually running so the
# answer is never inferred again.
#
# --ff-only ON PURPOSE. The droplet is a PULL-ONLY MIRROR (CLAUDE.md). If a
# fast-forward is not possible something has been committed here that is not
# on main, and this must stop rather than merge it.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"

echo "== droplet-deploy: $REPO"
echo "-- before: $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

git checkout main
git pull --ff-only origin main
SHA="$(git rev-parse --short HEAD)"
echo "-- after:  $SHA"

systemctl --user daemon-reload
for unit in sportsvyn-live-poller.service sportsvyn-daily-tick.service; do
  # The daily tick is oneshot behind a timer - restarting it runs it once
  # now, which is harmless and idempotent by design.
  echo "-- restarting $unit"
  systemctl --user restart "$unit" || echo "   (restart returned non-zero for $unit - check status)"
done

# Give the units a moment to log their startup banner before reading it back.
sleep 3

echo
echo "== running SHA, from each service's own startup line =="
for unit in sportsvyn-live-poller.service sportsvyn-daily-tick.service; do
  echo "-- $unit"
  journalctl --user -u "$unit" --since "-2 min" --no-pager 2>/dev/null \
    | grep -E "starting: pid=.* head=" | tail -2 || echo "   (no startup banner found)"
done

echo
echo "== expected SHA: $SHA =="
