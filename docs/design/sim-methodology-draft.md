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

## Bands (published, fixed)

| Grade | min gradeScore | | Grade | min gradeScore |
|---|---|---|---|---|
| A  | 88 | | C+ | 56 |
| A- | 82 | | C  | 48 |
| B+ | 76 | | D  | 36 |
| B  | 70 | | F  | < 36 |
| B- | 63 | | | |

## Calibration

**Stated principle (calibration), verbatim:**
> "An unattended draft is an average draft."

Band EDGES (never the formula) are calibrated so the median full-auto draft lands
B-/C+ and A is at most 5% of auto-drafts.

**Corpus + method:** 300 seeded full-auto drafts across the four launch presets
(mixed seats, `makeRng(5000+i)`), each graded; band edges adjusted until the
targets were met.

**Distribution (300 auto-drafts):** gradeScore min 24.1, p25 57.7, median 67.2,
p75 74.7, max 96, mean 65.9.

| Bands | median | A% | histogram (A / A- / B+ / B / B- / C+ / C / D / F) |
|---|---|---|---|
| Initial (naive) | B | 8.3% | 25 / 26 / 53 / 65 / 54 / 43 / 16 / 13 / 5 |
| **Calibrated (shipped)** | **B-** | **4.7%** | 14 / 17 / 36 / 55 / 61 / 54 / 32 / 23 / 8 |

The calibrated median is B- (B-/C+ zone) and A is 4.7% (<= 5%). Met.

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
