#!/usr/bin/env bash
# scripts/vercel-ignore-build.sh - Vercel's "Ignored Build Step" (vercel.json
# ignoreCommand, wed-6). Exit 0 = SKIP the build, exit 1 = BUILD.
#
# A commit whose changes since the last deployed commit are ALL under docs/ or
# *.md builds nothing a reader can see (handoffs, reports) and cost ~$1.5/day in
# build CPU. Anything else builds. Every doubt BUILDS: no previous SHA, a SHA
# the shallow clone does not have, or an empty diff.
#
# NOTE for the preview gate: a docs-only branch commit gets no Ready preview -
# its deployment is CANCELED by this step. The gate applies to code commits.
set -u
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
head="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
[ -n "$prev" ] || { echo "build: no previous deployment sha"; exit 1; }
git cat-file -e "${prev}^{commit}" 2>/dev/null || { echo "build: $prev not in this clone"; exit 1; }
changed="$(git diff --name-only "$prev" "$head" 2>/dev/null)" || { echo "build: diff failed"; exit 1; }
[ -n "$changed" ] || { echo "build: empty diff"; exit 1; }
if printf '%s\n' "$changed" | grep -qvE '^docs/|\.md$'; then
  echo "build: code changed"; exit 1
fi
echo "skip: docs-only ($(printf '%s\n' "$changed" | wc -l) files)"; exit 0
