# The Daily v2 - Product Spec

**Status:** design settled, ready to build. Supersedes hindsight-daily-puzzle-spec-v0_1.md in full.
**Playable reference:** docs/design/daily-full-mock-v3.html (see section 11)
**Written:** 3 Sep 2026

---

## 0. Why this is a rewrite, not a patch

The v1 Daily was measured before it was changed. Nineteen editions, 15 outside players, **every one played exactly once and never came back**. Completion was 89%, so the puzzle itself was fine - people who started it finished it in about ninety seconds. What failed was everything around it: the notification that would have brought a player back exists in the codebase and has never fired, the score meant nothing without a visible ceiling, and the season-guess bonus that was supposed to carry the skill paid 0.9%.

So: keep the data discipline, replace the loop.

---

## 1. The game

**One season. Twelve teams. Nine slots. One player per team.**

The year is shown. Twelve team cards are drawn from that season, each showing four to six of its players with their **season** stat lines. You open a team - **and opening commits you**. You must take exactly one player from it, you choose which slot he fills, and that team is spent.

Nine slots: `QB · RB · RB · WR · WR · TE · FLEX · K · DEF`
Three teams go unused, and choosing which to skip is part of it.

Scoring is **season fantasy points**, PPR, through the house scorer - the same `fantasyPoints()` the rest of the product uses, called on season sums instead of game rows.

### Why it works
- **Nothing is lookupable.** You can have the 2017 stat page open and still get it wrong, because the skill is allocation, not recall.
- **Cross-position comparison.** "Russell Wilson or Doug Baldwin, and you only get one Seahawk" has no common unit. That is the decision.
- **Real regret.** Take a back off Pittsburgh and three teams later New England offers Gronkowski with your TE slot already gone.

---

## 2. Board generation - the rules that make it fair

These are not preferences. Each one fixes a defect found by playing the mock.

**a. One standout per team.** No team card carries two players who rank top-3 at their position on the board. *Why:* a board where Pittsburgh held both Bell (341) and Brown (312) made the optimal roster skip the higher number, which reads as broken even though the math is right.

**b. Positional surplus.** At least two positions carry more good players than slots - e.g. five backs worth having for three back-ish spots, two elite quarterbacks for one slot. *Why:* without it, walking the teams in order and taking best-available scores 100%. Measured with the rule in place, over 383 shuffled orders: greedy averages **79%** of optimal and tops out at **96%**. It can no longer reach a perfect board.

**c. Scarcity placement.** Kickers and defenses appear only on a subset of teams, and preferentially on teams holding something better. *Why:* it makes the last two slots a real cost rather than a formality.

**d. Two losing teams.** At least two of the twelve had a losing record. *Why:* a bad team's best player is a genuine judgment call, and it stops the board reading as a leaderboard.

**e. The draw is shuffled.** Chip order is fresh every board. There is no house order to learn.

**f. Achievability guarantee.** The ceiling is computed as a **maximum-weight assignment** - one player per team, one player per slot, maximised - not as the best player per slot independently. *Why:* independent per-slot bests named Gurley three times and put two Rams on one roster. Nobody could have drafted that. Every board's perfect is reachable by construction.

---

## 3. The grade

Fires **the moment you finish**. Not at midnight - that delay is what killed v1's payoff.

- **Set-matched before display.** Holding the same nine players is the same roster, so a Gurley/Kamara swap between RB slots reads as two matches with a note, not two misses.
- **Side by side**, sticky `YOU` / `BEST ROSTER` column headers, one row per slot, matched rows collapsing to a tick.
- **Every miss names the cost and the reason** - "Kelce at KC went 208 · KC untouched" vs "you spent KC on someone else". Different mistakes, different sentences.
- **When the best roster skips a raw positional leader, it says so** - "Zuerlein scored 187 at K, but the best roster spends LAR elsewhere."
- **One paragraph about the season**, generated from *this board only*. No player is ever named who was not on it.

---

## 4. The two modes

### THE DAILY
- One board a day, **the same board for everyone**, seeded per edition.
- Ranked. Streak-bearing. One attempt.
- Grade instantly; **leaderboard at midnight** when the field is complete, delivered by push.
- Shareable glyph row: nine squares, green matched / black missed, plus score, percentage and streak.

### PRACTICE
- Unlimited boards, any time.
- **Unranked. No streak. No leaderboard.** Non-negotiable - the moment practice touches the streak, the Daily stops meaning anything.
- Customisable (see §5).
- Scores are kept for the player's own history only.

### THE ARCHIVE
- Past Dailies, playable after their day closes.
- Unranked, marked as archive, shows the day's real leaderboard for context.

---

## 5. Practice customisation

The axes, in the order they matter:

| Axis | Options | Notes |
|---|---|---|
| **Era** | Any decade, or a specific season | 1980s / 1990s / 2000s / 2010s / 2020s / All |
| **Board size** | 10, 12, 16 teams | Fewer teams = harder; more = easier |
| **Roster shape** | Full 9, or Offence only (7) | Drops K and DEF for people who resent them |
| **Difficulty** | Standard, or Deep pool | Deep pool relaxes rule (a), letting stacked teams appear |
| **Team** | Any club | Every board includes that club |

Defaults match the Daily exactly, so practice is a rehearsal unless you change something.

**Cross-era comparability, stated:** a 1982 board's ceiling is far below a 2017 board's because the passing game was different. Raw points are comparable **within** a board and never across eras. The Daily's daily leaderboard ranks on raw points (everyone had the same board); any all-time or aggregate ranking must use **percentage of perfect**.

---

## 5b. Leaderboards

Percentage alone breaks. Five boards at 90% would outrank fifty at 85%, and one 100% would crown someone forever. The fix is a qualification threshold, plus the recognition that the streak already rewards volume, so the quality board does not have to.

### Main board
Average percentage of the achievable ceiling over the last 30 Dailies, minimum 10 played.
- Rolling, so nobody retires on a hot week.
- The minimum is the point: five great boards do not outrank fifty good ones, and your bad days count.
- Shown as "88.4% - 7.4 of 8 avg". Percentage compresses - most players land 80-92% and ties are common - so the matched-slot average gives it texture.

### The other five, all first-class
- **Today** - raw points. Everyone had the same board, so the number means the same thing for all of them. Resets daily. This is the shareable one.
- **Streak** - current, then longest as tiebreak. This is where volume lives.
- **Perfect boards** - count of 100%s. Rare enough to brag about.
- **Boards played** - pure volume, no judgment.
- **Best board** - single highest percentage, with the date and season, so it reads as a story.

### Two rules that govern all six
1. Only the Daily feeds any public board. Practice and archive results go to the player's own history and nowhere else. The moment practice counts, the Daily stops being the thing everyone did on the same board.
2. Raw points are comparable within a board and never across eras - a 1982 ceiling is far below 2017's. The daily board ranks on points; anything aggregate ranks on percentage.

---

## 6. Home screen

One screen, ink, v1.2 module grammar.

1. **THE DAILY** - hero module. Today's edition number, the season if already opened, streak, and one primary button whose label follows state: `Play` / `See your grade` / `Leaderboard at midnight`. This is the only volt button on the screen.
2. **PRACTICE** - a module with the customisation summary as a line of chips ("2010s - 12 teams - full roster") and a quiet `New board` action.
3. **ARCHIVE** - the last five editions as rows: date, season, your score if played, a dash if not.
4. **LEADERBOARDS** - one row, opening the six boards of section 5b with the main board first.
5. **HOW IT WORKS** - three lines, collapsed by default. Open a team, you must take someone, four teams go unused.

Streak sits in the header on every screen in the game, never buried in a profile.

---

## 7. Retention - the things v1 built and never wired

These are not new features. They exist in the codebase and have never reached a player.

- **`daily-live` push at open**, `daily-revealed` at close. Both written in `lib/push/copy.js`. `push_sends` is empty; there are 40 registered devices. **Wire them.**
- **Streak, shown.** v1 had a 13-day streak and never mentioned it once.
- **The ceiling, shown.** The perfect roster is stored per edition and was shown to nobody.

---

## 8. Data

### Grain
Season totals. `nfl_player_season_totals`, keyed `(nfl_player_id, season_year, team_key)` - team in the key because footballdb splits traded players per team and collapsing them at storage loses one. Same column vocabulary as `nfl_player_game_stats`, so `fantasyPoints()` scores a season row with no new code: **one scoring function, two grains of input.**

### Sources by era

| Years | Source | Grain | Status |
|---|---|---|---|
| 2015-2025 | BDL | game | held |
| 2002-2014 | BDL | game | backfill in progress, script exists |
| 1999-2001 | nflverse | game | queued - new importer, GSIS identity |
| 1980-1998 | footballdb workbooks | season | **gating item: header drift across seasons unverified** |

### Known data rulings
- **Traded players: keep both rows, never sum at ingest.** A board picks one team's row; the career index sums across them. One storage shape, two honest consumers.
- **Fumbles lost: NULL for 1980-1998, never zero** - no source reaches back that far. The surface says so wherever those seasons appear.
- **Identity: `(normalized_name, team, season)`**, `matched_by` = exact | created | ambiguous, and **ambiguous refuses**. 27 names in `nfl_players` already collide with 2+ real people; name-only matching would attach a 1995 line to the wrong modern player. ~71% of a 1995 workbook needs create-on-ingest - that is its own build with its own verification, not a clause in an ingest.
- **Meta strings are generated from stat columns, never typed.** The mock lost two quarterbacks' touchdown counts to a hand-composed string and it was silent.

### Archive size
46 seasons x 15-20 distinct twelve-team draws each = **700-900 boards** before a repeat. The season is the frame; the draw is the variety.

---

## 9. Build sequence

1. **Season-totals table + the scorer reading it.** Nothing renders yet.
2. **Board generator** with rules (a)-(f), and the assignment solver for the ceiling. Testable headless: assert greedy never reaches 100% over N shuffles, assert the ceiling uses each team once.
3. **The board surface** - twelve chips, commit-on-open, slot choice, glyph row, clock.
4. **The grade** - set-matching, side by side, generated story.
5. **Midnight screen + leaderboard + push wiring.** The push copy already exists.
6. **Practice mode + customisation.**
7. **Home screen.**
8. **Archive.**

Steps 1-5 are the game. Everything after is expansion.

---

## 10. Open questions

- **How many workbooks exist**, and do 1980 headers match 1995? Gating the entire pre-1999 archive.
- **Practice board seeding** - should a practice board ever be a past Daily's board? (Lean: no. Keep them disjoint so the archive stays meaningful.)
- **Does the Daily rotate eras deliberately** - a 1980s board on Mondays - or draw uniformly at random? (Lean: weighted toward recency, because name recognition carries the game, with older seasons as a deliberate change of pace.)

---

## 11. Errata - rulings made in the build that supersede the text above

- **Eight slots, not nine: QB RB RB WR WR FLEX FLEX K.** No TE slot and no DEF. footballdb cannot distinguish WR from TE, so a TE slot made pre-1999 boards complete 43% of the time. TE stays FLEX-eligible. Four teams go unused, not three. This unlocked every season in the corpus.
- **Rule (d), two losing teams, is dropped.** No win-loss records exist in the corpus for any season. Records are not shown on the card and are never fabricated.
- **Scoring uses a dedicated 'daily' format in scorePlayer**, full PPR; simulator formats are untouched.
- **Fumbles lost is NULL for every season**, not only pre-1999. One rule for the whole corpus.
- **Corpus today is 31 seasons**: 1980-1999 footballdb and 2015-2025 BDL. BDL player stats begin at 2002 (1999-2001 return empty, probed twice); 2002-2014 is a backfill, post-launch.
- **Edition day is America/New_York** via todayEt(), the same function the v1 Daily uses. Editions exist from DAILY_V2_EPOCH = 2026-09-08; before that the route serves the preview only.
- **Playable reference is docs/design/daily-full-mock-v3.html**, which lives in the repo. A ruling exists when it is in docs/ with a SHA. Chat artifacts are not references.
