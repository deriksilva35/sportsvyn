# October — the house re-files when the cards post

**Filed:** 24 Sep 2026. **Build:** after The Run's first round is in.

Specified and deliberately not built. It is here rather than in
`post-season-debt.md` because this is not deferred to the off-season — it has a
named trigger and it should be built when that trigger fires.

---

## The requirement, as given

> The house re-files a day when its probables/lineups post, once, before the
> first lock — same door, same rules, only slots whose player is not starting.

Four constraints, and each one is load-bearing:

- **ONCE.** Not a loop, not every poller pass. A day gets one re-file.
- **BEFORE THE FIRST LOCK.** After a slot locks there is nothing to do about it,
  and after the first lock the card is partly sealed — see "when" below.
- **SAME DOOR, SAME RULES.** `saveOctoberPick`, the function the card's server
  action calls. No private insert; the refusals apply exactly as they do to a
  reader. This is the rule `lib/house/october.js` already follows and the reason
  `lib/house/october.test.mjs` greps the filer for `INSERT INTO`.
- **ONLY SLOTS WHOSE PLAYER IS NOT STARTING.** A legal pick is never touched. A
  re-file that rebuilt the whole card would silently replace picks the reader can
  see on the board, and the house's card would stop being the card it filed.

## Why it is wanted

The house files at day creation (`ensureOctoberDay` → `fileOctoberDay`), which is
hours before any club posts a batting order. So the bats it picks are chosen from
the active roster by PPG, and some of them will not be in the lineup that night.
A reader gets `notStarting` on their card and the word **swap**; the house has
nobody to tap it.

## What already exists to build on

Nothing new is needed to DETECT the condition — every piece is in the tree:

| piece | where | what it gives |
| --- | --- | --- |
| `notStarting(pick, {lineup, awayAbbr, homeAbbr, locked})` | `lib/october/pool.js` | the flag itself, the same one the card renders |
| `writeMlbLineups(sql, matchId, lineups)` | `lib/mlb/detail.js` | returns truthy when a posted card actually CHANGED — the "it just posted" edge |
| `lineupDue(match, opts)` | `lib/mlb/detail.js` | the cadence the poller already polls lineups on (4h window, 5 min unposted / 15 min posted) |
| the poller's pre-kick pass | `services/live-poller/poll.mjs` (~line 701) | already calls `writeMlbLineups` and counts the writes in its ledger |
| `fileOctober({userId, personaKey, contest, now})` | `lib/house/october.js` | files through the door, returns `{filed, of, cap, short, refused}` |
| `startersOnly` / `clubStarters` | `lib/october/pool.js` | cuts a pool to the posted card, which is what a replacement must be drawn from |

## Where it should hang, and the open question

The natural home is the poller's pre-kick pass, on the pass where
`writeMlbLineups` reports a CHANGE — that is the exact moment a card posts, it
already runs on `lineupDue`'s cadence, and it needs no new schedule.

**The question a builder must answer first:** the poller is a droplet service and
`fileOctober` reaches `lib/db.js`. Check that the poller's process can call the
October door at all (it writes through `sql` from the same module, so probably
yes) before designing around it. If it cannot, the fallback is a small cron on
the same cadence rather than widening the poller's job.

**"Once" needs a stamp.** There is no field for it today. Cheapest honest option:
a key on the contest's `meta` (e.g. `meta.house_refiled_at`), written after the
pass. Whatever is chosen, remember the jsonb rule in `CLAUDE.md` — merging into a
nested key means writing the nesting out explicitly, and `||` on an array appends.

**"Before the first lock" is per slot, not per card.** October locks each slot at
its own game's first pitch, so the honest reading is: re-file a slot only while
THAT slot is unlocked. `notStarting` already returns false for a locked slot, and
`refuseReason` would refuse the save anyway — so the door enforces it even if the
caller is careless. Rely on the door; do not re-derive the lock.

## The tests, as given

1. **A flagged house pick is replaced by a starter.** A house card with a bat who
   is absent from the posted lineup, a posted lineup for that game, and after the
   re-file that slot holds somebody who IS in it — drawn from the same pool a
   reader would see.
2. **A legal pick is never touched.** Every slot whose player IS starting comes
   out byte-identical, including the slots in games that have not posted yet.

Both belong beside the existing six in `lib/house/october.test.mjs`, which
already seeds its pool into `meta.pool` and so runs offline against DEV.

Worth adding beyond the two asked for: that the re-file is idempotent (a second
pass over an already-re-filed day changes nothing), and that a day whose clubs
never post is left exactly as filed.
