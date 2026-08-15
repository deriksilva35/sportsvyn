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

## Commit hygiene: what never gets staged, and what scripts/ is for

THE NEVER-STAGE LIST is short and it is about generated or secret files, not
about directories:
  package-lock.json   regenerated on Linux here; differs from the Mac lockfile
  .env / .env.local   scp'd in, gitignored
  node_modules        Linux-native on this host
  next.config.mjs     per Derik's standing instruction
  ios/                per Derik's standing instruction

`scripts/` IS NOT ON THAT LIST and never has been - 44 .mjs files are tracked
there already. Committing an ops script is the normal case, not an exception.
What stays OUT of git is the throwaway: one-shot probes, verification queries
and apply-scripts belong in the session scratchpad, because a script written to
answer one question on one evening rots into a trap the moment the schema moves.
The test is reuse, not size: if it will be run again on a future slate, it
belongs in scripts/; if it answered today's question, it does not.

ANY SCRIPT IN scripts/ THAT REACHES PROD MUST READ ITS CREDENTIAL FROM THE
ENVIRONMENT. `neon(process.env.PROD_DATABASE_URL)`, never an inline connection
string, and never a URL pasted into a default argument. Source with
`set -a && . ./.env.local && set +a` and let the process inherit it; no secret
on a command line, ever. A committed script with a credential in it is a leak
that survives every future clone.

## jsonb `||` is SHALLOW, and it appends to arrays

Two production defects this month, both from the same operator:

  **final_seen_at wiped, 14 Aug.** `gameDetail.js` wrote
  `metadata || '{"detail":{at,final}}'`. The merge is one level deep, so the
  whole `detail` object was replaced and the `final_seen_at` a *different*
  writer had nested into it was deleted on every detail fetch. The slate lost
  its flap immunity and nobody noticed, because the alarm compared two non-null
  readings and a wipe-to-null never pairs.

  **A 65th board entry, 15 Aug.** The Daily's close job tried
  `board || jsonb_build_object('__perfect', ...)`. `board` is an ARRAY, and
  `array || object` APPENDS:

      '[{"id":1}]'::jsonb || '{"__perfect":{...}}'::jsonb
        -> [{"id":1},{"__perfect":{...}}]

  The perfect lineup — carrying every player's score — would have become a
  player row. Caught before shipping only because the shape was checked.

THE RULE. Merging into a NESTED key means writing the nesting out explicitly:

    metadata || jsonb_build_object('detail',
      COALESCE(metadata->'detail','{}'::jsonb) || <incoming>::jsonb)

and if a sibling key must survive an incoming write that could carry it,
re-assert it after the merge. Never `||` an object onto a value you have not
confirmed is an object — check the shape, or give it its own column.

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
