# The first thing to read after game 1

**Owed since:** 22 Sep 2026, when October and The Run shipped.
**Do it:** the first time a postseason game goes FINAL and its box score lands.
**Why it is first:** every other claim in both games rests on it.

---

## What is unproven

October and The Run are both scored by `lib/mlb/fantasyPoints.js`, and that
scorer has never seen a real `mlb_player_game_stats` row.

It is tested — 6 cases, the table, the singles derivation, the negative arm,
the two-way split — and every one of those tests is a **fixture I wrote**. The
shapes came from migration 110's column list, not from a row the ingest
actually produced. DEV holds the 2025 postseason's 47 matches but none of their
stat rows, so the gap could not be closed before the slate.

**What that means concretely:** if the ingest writes `home_runs` where the
scorer reads `home_runs`, everything works. If it writes null where the scorer
expects 0, or the column is populated by a path nobody exercised, then every
card in both games scores wrong and **looks completely healthy doing it** — a
plausible number with nothing to compare it to.

This is the same class of defect as the possession dot and the dead MLB chip:
not a crash, a confident wrong answer.

---

## The read, in order

Run it as soon as one game is final. It takes about five minutes.

**1. Does a stat row exist at all, and what is in it?**

```
set -a && . ./.env.local && set +a
node --input-type=module -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.PROD_DATABASE_URL);
const [m] = await sql\`SELECT m.id, m.slug FROM matches m
  JOIN leagues l ON l.id=m.league_id AND l.slug='mlb'
  WHERE m.status='final' AND m.stage IS NOT NULL
  ORDER BY m.kickoff_at DESC LIMIT 1\`;
console.log('match', m?.slug);
const rows = await sql\`SELECT * FROM mlb_player_game_stats WHERE match_id=\${m.id}\`;
console.log('rows', rows.length);
console.log(JSON.stringify(rows[0], null, 1));
"
```

**Check:** rows exist; a batter's row has non-null `at_bats`/`hits`; a pitcher's
has non-null `outs_recorded`. **A zero and a null are different** and the
scorer treats them differently — `n()` coerces null to 0, so a null `hits`
scores 0 silently rather than refusing.

**2. Does the scorer agree with the box score?**

Take one batter and one pitcher off that row and compute by hand against the
printed table:

```
bats  1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5
arms  outs 0.75 · K 2 · W 4 · ER -2 · H -0.6 · BB -0.6
```

Remember **a home run is a hit** — singles are `hits − 2B − 3B − HR`. A player
who went 1-for-3 with a homer scores 10 for it, not 13.

**3. Does a card show the same number?**

`scoreCard` (October) and `scoreRoster` (The Run) must produce what step 2
computed. The Run sums **every game the club played in the round**, so check it
against a club with two finals, not one.

**4. Does the settle write it?**

Only once every match on the day / every series in the round is done. A refusal
before then is correct and is not the thing being tested.

---

## What to do if it disagrees

**Fix the scorer or the adapter, not the test.** The fixtures are the suspect
here, not the arithmetic — the arithmetic is checked against the mock's own
Harper line and holds. If a column name is wrong, `lib/october/pool.js`
`asGameRow()` is the one place the season endpoint's names are mapped, and the
game-row names are read directly in `fantasyPoints.js`.

**Do not settle a day or a round until this reads clean.** A settled contest
writes `score` and flips `settled`, and re-grading afterwards means explaining
to everyone who played why their number moved.
