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

---

## Done: 22 Sep 2026, against the preview's first final

The read was owed the first time a game went final. The preview put one there
before the postseason did — **TB @ NYY, `mlb-2026-09-22-tb-nyy`, match 39770** —
so it was done against that, with one change to step 1's query: a regular-season
day has `stage IS NULL`, and the query above filters `stage IS NOT NULL`. The
slate, not the stage, is what makes a row real, so the filter became a kickoff
window.

**Step 1 — the rows exist and the nulls are the right nulls.** 23 rows. Every
batting column is null on exactly 4 of them and every pitching column on exactly
19: 4 pitchers, 19 batters, and no row that is null in both disciplines. The
nulls are the *other* discipline's columns, which is the shape the scorer's
`slotPoints` was written for — not a missing value dressed as a zero.

**Step 2 — the scorer agrees with the box score.**

    Nick Martinez  18 outs, 7 K, 0 W, 2 ER, 5 H, 1 BB
      by hand  13.5 + 14 + 0 - 4 - 3 - 0.6 = 19.9    scorer 19.9
    Cody Bellinger  1-for-4, HR, 2 RBI, 1 R
      by hand  0*3 + 10 + 4 + 2 = 16                 scorer 16

Bellinger is the home-run-is-a-hit case the doc warned about: 1 hit, 1 homer,
`singlesOf` derives 0 singles, so he scores 10 for the swing and not 13. The
two-way guard holds on the same row — `slotPoints('bat', martinez)` is 0, so an
arm in a bat slot is paid nothing rather than paid twice.

**Step 3 — the cards show the same number.** `scoreCard` on a five-slot lineup
of that game's arm and its four best bats: 19.9 + 16 + 13 + 9 + 8 = **65.9**,
which is the hand sum, with all five slots `final` and `complete: true`. The
arm line prints `6.0 IP · 7 K · 2 ER` — 18 outs read as six innings, not
eighteen. `scoreRoster` returns the same per-player numbers through its own
path.

**What is still unproven:** The Run sums *every* game a club played in a round,
and no club has two finals in a one-day preview round. The single-game sum is
proven; the multi-game sum waits for a doubleheader or a real round.

**Nothing has been settled.** Step 4 refused, correctly: the day's other 15
games are not final.
