# Data Keeper queue

The Data Keeper (`crew/bin/data-keeper`, nightly 02:00 PT) takes the TOP UNCHECKED job below, runs
its `dry-run` command and nothing else, and hands Derik the result with the `apply` command. It
NEVER runs `apply`; Derik (or an Approve in CrewOS that replays this exact text) does. Check the box
by hand once a job is applied and verified, so the next night moves down the list.

Entry format (the script parses exactly this):

    - [ ] **<job title>**
      - script: the existing script in scripts/
      - dry-run: `node scripts/<script> <args>`   (no apply flag, ever; the script is refused if it has one)
      - apply: `<the exact command Derik runs by hand>`
      - parser: footballdb-import | team-colours-fill   (how crew/lib/dataKeeper.mjs reads that script's totals)
      - sample: a regex; the first 10 matching output lines are the sample rows
      - notes: free text

The dry run runs with `DATABASE_URL` = the read-only `CREW_READER_URL`, so a script that tried to
write would be refused by the database as well. Both scripts below only READ in a dry run
(`scripts/footballdb-import.mjs` passes `{ apply }` to its identity resolver; `team-colours-fill`
writes only inside `if (apply)`).

## Jobs

- [ ] **daily-season-backfill 2000-2001**
  - script: scripts/footballdb-import.mjs
  - dry-run: `node scripts/footballdb-import.mjs 2000-2001`
  - apply: `DATABASE_URL="$PROD_DATABASE_URL" node scripts/footballdb-import.mjs 2000-2001 --apply`
  - parser: footballdb-import
  - sample: `^\d{4}\s+teams\(About\)|^\s+written=|^\s+\S.* -> never attached`
  - notes: step C of the Daily season-pool plan (mon-5). Reads the tracked workbooks in .data/footballdb/NFL_Player_Stats_1980-1999/ (they include 2000 and 2001). Contradiction = `gamesConflict` above 0. Quiet window only; the gate afterwards is 300 draws at 100% on PROD rows.

- [ ] **daily-season-backfill 1997-1999**
  - script: scripts/footballdb-import.mjs
  - dry-run: `node scripts/footballdb-import.mjs 1997-1999`
  - apply: `DATABASE_URL="$PROD_DATABASE_URL" node scripts/footballdb-import.mjs 1997-1999 --apply`
  - parser: footballdb-import
  - sample: `^\d{4}\s+teams\(About\)|^\s+written=|^\s+\S.* -> never attached`
  - notes: "add 1997-2001" in the plan; follows 2000-2001. Same script and gate. Pre-2002 seasons fail mostly on the TE slot (footballdb has no position column), so read the positions step before the apply.

- [ ] **team-colours recheck**
  - script: scripts/team-colours-fill.mjs
  - dry-run: `node scripts/team-colours-fill.mjs`
  - apply: `DATABASE_URL="$PROD_DATABASE_URL" node scripts/team-colours-fill.mjs --apply`
  - parser: team-colours-fill
  - sample: `^\s+(FILL|UNFILLED)\s`
  - notes: fills only teams whose BOTH colour columns are NULL (CFB from one CFBD call, EPL from the reviewed table). The CFB half calls CFBD, so the crew host needs cfbd.token in its secrets dir; without it the script exits non-zero and the run reports status=error. Re-run when a new FCS opponent or promoted club appears.

Note: colour-source disagreement detection (comparing team colours across sources) is out of scope for month one.
