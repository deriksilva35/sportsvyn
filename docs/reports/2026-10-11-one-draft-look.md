# One draft look - recon (sun-2, read-only, nothing built)

Question: can every draft surface share ONE room component with the Game Drafts look? That look
is a navy header with a lime eyebrow, a seat strip, pool rows (position chip and Draft pill),
faded drafted rows, and the same result screen.

Short answer: share the LOOK, not the room. Game Drafts is a 4-seat, 4-round, slot-free room
with an unfiltered ~30-row pool. The 12 x 8 rooms need panels it has no equivalent for: a
roster/slot view, search and filters over 250+ players, ADP columns, arm-then-confirm, keepers,
and tracker logging.

## Surfaces today
| Surface | Files | Renders |
|---|---|---|
| Game Drafts | components/draftGame/GameDraftRoom.js (98 lines), GameDraftResult.js, app/draft/game/* | 4 seat tiles, full pool as rows, one-tap Draft, server clock sweep; result hero + players + The room |
| Weekly ranked Draft: home and states | app/draft/page.js (384 lines), components/draft/SeatSelect (12-seat grid), DraftLiveCard, DraftGrade, RankedComplete; app/draft/draft.css | rules, seat pick (irreversible), live best-six card, settled grade vs the field, BY SEAT table |
| Weekly ranked Draft: THE ROOM | /sim/draft/[id] (isRanked lookup) -> components/sim/DraftRoom.js (1280 lines), sim.css (1422 lines) | swipe pager BOARD/PICK/ROSTER; desktop 3 columns; position, team and class filters, search, sorts; ADP/VAL columns; arm-then-confirm; AUTO; keepers; minors; snake grid |
| Results | app/results/[game]/[contest], lib/results/draft.js, components/results/Results.js (299 lines, shared by 4 games) | "Your draft" vs "the best draft", pick rows "1.06 · ADP 3 · +3 value" |
| Mock / practice | the same DraftRoom; app/sim/* lobby (StartForm, YourDrafts, SeatStrip, ...); DraftResults + share card route | as the ranked room, any config |
| Tracker | components/sim/TrackerRoom.js (722 lines, separate on purpose), tracker.css, TrackerResults | log every team's picks, UNDO, no clock, 3 tabs |
| League drafts | no own room: startLeagueDraftFor makes a drafts row and renders in DraftRoom | franchise names, keepers, minors, N rounds |
| Other | /draft/board (shared BoardPage), lobby rows, rankings draftBySeat | |

## What 12 seats x 8 rounds needs beyond Game Drafts
- Seat strip: 12 tiles do not fit 390 px. Use a horizontally scrolling strip centred on the seat
  on the clock, or compact dots with "You" and "On clock" expanded. Keep the BOARD grid as its
  own tab.
- A roster/slot panel (QB/RB/WR/TE/FLEX + bench), specific to the mode.
- The pool: search, position chips (incl. FLEX), sorts, and virtualised rows. Game Drafts
  renders every row, which is fine at 30 and not at 250-927.
- ADP / RANK / VAL columns.
- Pick flow: arm-then-confirm in 12 x 8 vs one tap in Game Drafts.
- Timer: DraftRoom's server deadline + renderedAt + AUTO vs Game Drafts' refresh-at-zero sweep.
- Keepers, franchise names and minors for leagues. Tracker logging stays its own panel.

## Proposed split
- Shared presentational layer, components/draftRoom/, taking props only with no data fetching:
  - RoomShell (navy header, eyebrow, clock);
  - SeatStrip / SeatTile (4-up and scrolling-12 variants);
  - PoolRow (chip, name, sub-line, action slot, `taken` variant);
  - useSecondsLeft;
  - ResultHero (points, "Nth of N", counted/faded picks, The room, Share + CTA).
- Mode panels stay separate: GameRoomPanel, RankedRoomPanel/MockRoomPanel (DraftRoom's pager,
  filters, armed flow), RosterPanel, BoardGrid, KeepersShelf, TrackerRoom.
- One adapter per mode, producing a common row and seat shape. The backends are NOT merged:
  Game Drafts' contest_entries.meta.room vs drafts + draft_picks.

## Sizes (one dev, with visual QA and test updates)
| Option | Days | Notes |
|---|---|---|
| A. Weekly Draft room + results to the new look | 4-6 | the ranked room IS DraftRoom, so restyling it also restyles mock rooms unless forked |
| B. Mock/practice + tracker + lobby on top of A | 6-9 | TrackerRoom has its own CSS; sim.css has arcade :where() rules |
| C. One true shared component for all | 15-25 | riskiest: re-platforming DraftRoom (8-12 d) |
| C-lite (recommended). Shared shell/strip/rows/result used by Game Drafts, the ranked room and results; mock/tracker/league keep their skin | 8-10 | one look where it is public; legacy where it is a tool |

## Risks
- 25 test files read DraftRoom.js / TrackerRoom.js as source and pin markup or class names
  (draftRoomV2, colGrid, draftOneScroll, autoDraft, pickRow, roomFlags, ...). Renaming classes
  breaks them, and most are law tests.
- DraftRoom's effects interlock (timer, AUTO, canPick, scroll memory, hydration-safe clock).
- The ranked room lives at /sim/draft/[id], so it is tied to the sim chrome (RoomScope, tab
  bar).
- The weekly seat pick is irreversible, so a new seat strip must not look reversible.
- S4 may retire the weekly Draft after the 13 Oct review. If it does, option A mostly
  disappears, and the question becomes mock/practice only (B or C-lite).
