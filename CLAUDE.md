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

## THE SUITE IS THE WHOLE SUITE, and it is the default

ANY RELAY THAT MERGES RUNS THE FULL SUITE BEFORE THE MERGE. Not after it, not
on the touched directories, not on the files the relay opened - THERE IS NO
TOUCHED-DIR SHORTCUT, and the same applies to any relay that commits or deploys.
With env sourced:

    set -a && . ./.env.local && set +a && node --test $(git ls-files '*.test.mjs')

Before the merge, because a suite run after it has nothing left to decide: the
branch is already in main and the only remaining move is a revert. The run is the
gate, so it happens while the gate can still be shut. "Full suite" is the floor,
and a relay that reports a green scoped run has reported nothing at all about the
tree it is merging into.

A BASELINE IS ZERO. Not "zero new", not "the same failures as yesterday" - zero.
A red test that is left red because it was red before is a test nobody will ever
read again, and the four receipts below all began as somebody's "pre-existing".
Where a failure is a fixture or data gap rather than a defect, the fixture is
fixed in the test's own before(), with the cost of that repair written down.

WHY, with the receipt. `lib/legal.test.mjs` - the guard that no user-facing string
names a data vendor - went red in 985808c and stayed red through FOUR commits,
because every relay in between ran the suite on the directories it had touched and
lib/ was never one of them. The test that exists precisely to catch a slip nobody
is looking for is the test a scoped run is guaranteed to skip: it lives nowhere
near the code that breaks it. That is the whole point of it.

AND IT WAS NOT THE WORST ONE. The first full run written under this rule found
three more asleep, the oldest by eighteen days: `app/my/myLayout.test.mjs` pinned
the literal `Board 1 - locks ...` and 1f84f68 (5 Sep, "board number is computed,
never a typed '1'") made the number data. Two others in
`components/pickem/pickemBoardV2.test.mjs` had typed kickoffs - '2026-09-18',
'2026-09-20' - future on the day they were written and past five days later, so
"2 still open" became "all locked" with nobody watching. A fixture asserting
something about OPEN games is written relative to now, or it is a dated cheque.

TWO MORE WERE DATA. One got a fixture; the other turned out to be the ASSERTION.
`lib/gridiron/topicEnvelope.test.mjs` wanted a populated NFL envelope from a
database whose NFL anchor season had ONE played game; its before() seeds three
finals in week 99 - outside any real schedule, so a parallel weekly-board fixture
cannot find them - and its after() asserts its own teardown.

`lib/fantasy/leagueShare.test.mjs` is the other one, and it is the better lesson:
A RED GUARD IS NOT ALWAYS A BROKEN FIXTURE - SOMETIMES THE GUARD IS WRONG. It
asserted migration 085's invariant ("every owned draft_config has an owner row")
across the whole table, and DEV held 46 without one. The first fix was a fixture
that re-applied 085's backfill in before(). Then a READ-ONLY COUNT ON PROD said
75 there, and NOT ONE of them a league: every single one comes from
startCustomDraftFor ('manual') or startTrackerDraftFor ('tracker'), which build
one reader's own draft room - no franchise to claim, never listed by getMyLeagues
(fantrax-only), and the owner is resolved from draft_configs.user_id directly, so
nothing is broken for anybody. Every FANTRAX config on PROD has its row.

So the invariant is scoped to `source = 'fantrax'` and the backfill is gone. GO
AND MEASURE THE OTHER DATABASE BEFORE REPAIRING THIS ONE: the fixture would have
written 75 rows into PROD that the product never creates, and it had already
written 40 into DEV, which were removed. The rule that survives is that a fixture
which repairs data is a fixture that can no longer see a defect - so reach for it
only once you know the data is genuinely wrong.

The rule is therefore about REACH, not about cost. Scoped runs are fine while
iterating - run lib/october/ forty times while writing lib/october/. But the run
that decides whether something ships is the one that has to see the files this
relay never opened, and that is the full suite. Sourcing .env.local is part of
the gate: without it ~128 tests fail for want of a connection string, and a relay
that reads those as noise has taught itself to read real failures as noise too.

TWO WAYS THE GATE LIES, both met while writing it:

- `git ls-files` LISTS TRACKED FILES. A test file written this relay and not yet
  added is not in the run, and the run is green because the new test was never
  executed. `git add` the new tests BEFORE the gate run, or the guard you just
  wrote guards nothing.
- LINT AND THE SUITE USED TO RACE. The mount tests write and unlink real .mjs
  stub files; eslint walking the tree at that moment died on an ENOENT for one
  that existed a millisecond earlier, and a suite killed mid-run left the stubs
  behind in app/ and components/ where the next lint counted them as thirty new
  problems. Both are fixed at the cause rather than by sequencing:

## MOUNT-TEST STUBS LIVE IN test-tmp/

A test that stubs `next/link`, a `.css` import or a server action writes a real
file. Every one of those goes through `stubPath()` from lib/testing/stubDir.mjs,
which puts it in `test-tmp/` at the repo root - eslint-ignored (eslint.config.mjs)
and git-ignored - and never next to the test. The test still creates and removes
its own stubs; what changed is that a leftover lands somewhere that costs nothing
and a linter never walks the directory at all.

The name carries the pid, because `node --test` gives each test file its own
process and four different files each wanted a stub called `__css_stub.mjs`. Next
to the test those were four paths; in one directory they would have been one file
and a race.

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
