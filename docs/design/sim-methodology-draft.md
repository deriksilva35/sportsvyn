# Mock Draft Sim — Grade Methodology (draft)

Transcription source for the future /methodology page section. Formulas and
stated-principle sentences are verbatim from `lib/fantasy/grade.js`.

## The grade

A draft grade combines two subscores, each 0-100:

```
gradeScore = 0.6 * valueScore + 0.4 * constructionScore
```

**Stated principle (weights), verbatim:**
> "The draft is mostly what you paid vs the market, partly what you built."

### valueScore (0-100)
The display-value (positive-good) of your **skill picks only** — QB, RB, WR, TE.
Kickers, defenses, and any replacement-level filler are excluded entirely.

```
displayValue(pick) = overall_pick - adp_at_pick        (fell to you = +, reach = -)
rawValue           = sum of displayValue over skill picks
normValue          = rawValue / (teams_count * skillPickCount)   # compares across presets
valueScore         = clamp(50 + 120 * normValue, 0, 100)         # 50 = drafted at market
```

Normalizing by `teams_count` makes an 8-team and a 12-team draft comparable (a
player can fall further between picks in a bigger league).

### constructionScore (0-100)
```
constructionScore = clamp(100
  - 12 * (skill starters filled after round 11)
  - 15 * (bench >60% one position ? 1 : 0)
  - 10 * (bye-stack warnings), 0, 100)
```
- **(a) No end-game scramble:** the skill starting slots (QB/RB/WR/TE/FLEX) should
  be filled by round 11. K/DST are expected in rounds 13-15 and are NOT counted.
- **(b) Balance:** a bench more than 60% one position is penalized once.
- **(c) Bye stacks:** each week where 3+ starters share a bye is penalized.

## Bands (published)

Recalibrated 2026-08-02. Edges move only in a deliberate recalibration session
(the formula never moves); see Calibration below for the previous ladder and why
each edge changed.

| Grade | min gradeScore | | Grade | min gradeScore |
|---|---|---|---|---|
| A  | 93 | | C+ | 59 |
| A- | 86 | | C  | 51 |
| B+ | 80 | | D  | 39 |
| B  | 73 | | F  | < 39 |
| B- | 66 | | | |

## Calibration

**Stated principle (calibration), verbatim:**
> "An unattended draft is an average draft."

Band EDGES (never the formula) are calibrated so the median full-auto draft lands
B-/C+ and A is at most 5% of auto-drafts.

**Corpus + method:** 300 seeded full-auto drafts across the four launch presets
(mixed seats, `makeRng(5000+i)`), each graded; band edges adjusted until the
targets were met.

**Distribution (300 auto-drafts, 2026-08-02 pool):** gradeScore p25 59.4,
median 70.4, p75 78.6.

Both rows below are the same 300 drafts on the same pool - only the band ladder
differs, since calibration never touches the formula.

| Bands | median | A% | histogram (A / A- / B+ / B / B- / C+ / C / D / F) |
|---|---|---|---|
| Previous ladder (88/82/76/70/63/56/48/36) | B (70.4) | 8.3% | 25 / 22 / 44 / 63 / 53 / 35 / 35 / 17 / 6 |
| **Recalibrated (shipped)** | **B- (70.4)** | **3.7%** | 11 / 17 / 36 / 58 / 71 / 35 / 45 / 18 / 9 |

The first row reproduces the alert exactly - A 8.3%, median band B - which is the
confirmation that this fixture is the pool the monitor was complaining about. The
recalibrated median is B- (B-/C+ zone) and A is 3.7% (<= 5%). Met.

### Recalibration, 2026-08-02

The daily monitor breached the A ceiling three days running (7.3% / 6.0% / 8.3%)
and the median tipped into B, which is the alert condition
(`shouldAlertCalibration`, 3 consecutive readings over 5%). Grades had drifted
generous against the stated principle.

**The centre and the tail had moved by different amounts**, and that shaped the
fix. Through the middle the pool sits about +3 higher than at first calibration
(median 67.2 -> 70.4, p25 57.7 -> 59.4) as FFC's board consolidates through the
summer: ADP tightens, auto-picks land nearer market, value subscores rise
together. But at a fixed edge of 88 the A-rate went 4.7% -> 8.3%, far more than a
+3 level shift explains. A single uniform shift could not hold both claims - one
big enough to fix the tail drags the median down its band, one that centres the
median leaves the tail over the ceiling - so each claim was calibrated where it
lives:

| Edge | Old | New | Move | Why |
|---|---|---|---|---|
| A  | 88 | 93 | +5 | The ceiling is a claim about the tail, and the tail fattened more than the centre moved. 88 also sat on a dense cluster (~5 drafts per point at 88-89), so small board drift pushed several across at once; past 93 the corpus thins to ~1 draft per point, so the line sits somewhere stable. |
| A- | 82 | 86 | +4 | Absorbs half the extra stretch created by lifting A more than B. Band width 6 -> 7. |
| B+ | 76 | 80 | +4 | Absorbs the other half. Width stays 6. |
| B  | 70 | 73 | +3 | Tracks the centre. The median (70.4) sat 0.4 ABOVE the old B edge, which is why one ordinary day tipped the median band into B and fired the alert. |
| B- | 63 | 66 | +3 | Tracks the centre, and puts the median 4.4 into a 7-point band instead of on its ceiling. |
| C+ | 56 | 59 | +3 | Same level shift below the median. |
| C  | 48 | 51 | +3 | Same. |
| D  | 36 | 39 | +3 | Same. |

Band widths go 6/6/6/7/7/8/12 -> 7/6/7/7/7/8/12: the ladder stays legible and no
band doubles.

**Validation.** Checked against five real pool snapshots (2026-07-20 .. 08-02) in
both row orderings (see below): A peaks at 3.7% and the median lands B-/C+ on
every one. The 1.3-2.0pp of ceiling headroom is deliberate.

**Row order is part of the corpus.** `createDraftState` sorts the pool by ADP with
a *stable* sort, so players sharing an ADP are drafted in the order the rows
arrive - and that alone moves the A-rate by up to 3pp on an identical pool. The
checked-in fixture is therefore emitted in a defined order
(`ORDER BY scoring_format, teams_count, adp, ffc_player_id`) so regeneration is
reproducible; the live monitor queries without an ORDER BY, so its reading can
differ from the fixture by about that much. The ceiling headroom above is sized to
cover it. Making the engine's sort fully order-independent would change drafting
behaviour, which is a formula change and out of bounds for a calibration session.

## Callouts

- **Best Value / Biggest Reach:** skill positions only (QB/RB/WR/TE), and only from
  round 3 onward so round-1 noise never headlines. Best value = the pick that fell
  furthest past its ADP; biggest reach = the earliest-vs-ADP pick.
- **The Pivot:** the pick the engine assigned the highest need weight — the most
  need-driven roster decision (reconstructed by replaying the draft, since need
  weight is not persisted).
- **Bye stacks:** any week with 3+ starters sharing a bye.

## The Read — AI prose validators

The Read is one 90-140 word paragraph in the Sportsvyn register, generated once on
first results view and persisted (`draft_reads`); never regenerated on view. The
server-side validators, all of which must pass or the deterministic fallback prose
is used (`prose_source = 'fallback'`):

1. **Length band:** 90-140 words.
2. **Dash scan:** no em dash or en dash (hyphens only).
3. **Banned vocabulary:** no praise interjections ("nice job", "great pick", "well
   done", "nailed it", "crushed it") or exclamation marks; no pick-shaped advice
   ("you should have", "should've", "next time", "would have been better",
   "instead you"); no hedging ("maybe", "perhaps", "arguably"); no season
   predictions or gambling language.
4. **Grounding:** every capitalized name candidate in the prose must exist in the
   envelope (the ledger + callout + bye-stack names). Literal names only — the
   prompt may use names exactly as given, never expanded or nicknamed.

Fallback prose is assembled deterministically from the callouts: a grade sentence,
a value sentence (best value), a reach sentence, a pivot sentence, and the
value-vs-construction lean.
