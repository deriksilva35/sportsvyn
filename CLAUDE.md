@AGENTS.md

## Remote Dev Environment (considered-cc droplet)

This repo is cloned on an always-on DigitalOcean droplet (host: considered-cc,
IP 165.227.30.35, user: derik) at ~/projects/sportsvyn, in addition to the Mac.
The droplet runs Claude Code on the Max subscription, inside tmux, reachable
from phone/laptop/desktop via Remote Control (Claude app -> Code tab).

Rules for any CC session running ON the droplet:
- The droplet is a PULL-ONLY mirror. Origin of truth for commits is wherever
  the work is actively done; use `git pull` to sync, and only push deliberate,
  reviewed work.
- NEVER commit the droplet's regenerated package-lock.json. It was rebuilt on
  Linux and contains platform-specific (linux-x64) native binaries that differ
  from the Mac lockfile. Leave lockfiles out of any droplet commit.
- Do not commit .env / .env.local — secrets were scp'd in and are gitignored.
- node_modules on the droplet is Linux-native; never commit it.

Restart the droplet's Remote Control session for this repo with:
  tmux new -d -s cc-sportsvyn 'cd ~/projects/sportsvyn && claude --remote-control --name sportsvyn'

## Migration numbering

Migration numbers are assigned at transcription time as
(highest existing file in migrations/) + 1. Never carry a number from a draft,
scratch file, or prior session note - those rot as the tree advances. Scan the
target objects against the migrations between the number you expect and the
actual highest before applying; do not assume the repo matches the plan.

## Gridiron datetime / timezone boundary (lib/gridiron/ingest.js)

Provider datetimes for the NFL/CFB feeds pass through ONE module,
lib/gridiron/ingest.js:
- Raw `new Date(providerString)` on a provider datetime is FORBIDDEN outside
  that module. Always call toUtc(dateTimeStr, dateTimeUtcField, provider).
  SportsData strings are US-Eastern local with no offset ("2025-09-04T20:20:00")
  and parse 4-5h wrong naively; BDL/CFBD are already UTC 'Z' but still route
  through toUtc() so the boundary stays in one place.
- Ad-hoc `AT TIME ZONE` SQL for provider time conversion is FORBIDDEN outside the
  exported easternLocalToUtc() helper (the single sanctioned ET-local -> UTC
  conversion, done DST-aware in Postgres).
