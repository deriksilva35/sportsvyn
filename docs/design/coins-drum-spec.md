# Coins + The Drum (weekly drawing) - spec

Relay droplet-coins-1, written 20 Oct 2026 from two sources, both owned by Derik:
- Mock: Design canvas "Sportsvyn Coins - Weekly Raffle" (claude.ai/artifact/3ztC47eWch42oSCiC1YL7e),
  4 phone screens at 390 wide.
- Rules: "Sportsvyn Weekly Drawing - Official Rules v0.1" (claude.ai/artifact/1DwuePiwMo48YJQRZEqknA),
  rev 8, dated 19 Oct 2026. Bracketed placeholders are for counsel.

Coins are weekly raffle tickets, not currency. They are earned by play only, never sold, have no cash
value, and every coin is entered in the week it was earned.

## Rules v0.1, condensed (the rules doc is the source of truth; s = section)

s1 Eligibility. Free sweepstakes by [LEGAL ENTITY NAME], [MAILING ADDRESS]. No purchase necessary; the
Arcade Pass or any paid feature never grants coins, entries or odds. Winners: legal residents of the 50
states + DC, 18+ at entry. Players 13-17 may play and earn coins but may not win; their coins are NOT
entered. Void in [STATES COUNSEL EXCLUDES]. Employees and household excluded. Apple is not a sponsor;
prize brands (Amazon, Visa) are not sponsors. One account per person; extra/automated/shared accounts void.

s2 Schedule. A week opens Tue 9:00:00 am PT and closes the next Tue 8:59:59 am PT (the Close). The
drawing runs at the Close; the next week opens at the same moment. First week opens [START DATE].
Ending the program needs 7 days' notice in app and on sportsvyn.com; held coins go into the final
drawing. The server clock is official; the app shows local time for convenience.

s3 The coin meter. Play fills a meter with arcade points; every 100 points mints one coin into the
player's hand. Meter progress carries week to week; coins do not. Points per public contest that
settles during the week:

| Event | Arcade points |
| --- | --- |
| First public game played in a week (any game) | 100 (one coin on the spot) |
| Each further public contest completed and settled | 25 |
| Finish in the top 25% of a settled contest | 50 |
| Finish in the top 10% of a settled contest | 100 |
| Finish 1st, 2nd or 3rd in a settled contest | 150 |
| Win a settled contest outright | 250 |
| Play in 3 consecutive weeks (awarded at the third) | 50 |

Eligible games: The Daily, The Weekly, The Draft (weekly), Pick'em, The Run and October, plus each new
public game announced as eligible from its week. NOT eligible: practice modes, mock drafts, private
leagues, any contest with fewer than 10 entrants. Cap: 10 coins per week; points beyond still carry in
the meter. Point values change only before a week opens.

s4 Entering. Each week posts prize drums (e.g. 2 x $25 gift cards, 5 x $10 gift cards, 1 x cap), each
with its prize count. One dropped coin = one entry in that drum. Players drop any split, any time
before the Close, and may keep some in hand. A dropped coin cannot be moved or taken back. At the Close,
coins still in hand drop automatically into the LOWEST-VALUE drum. No mail-in method (nothing is ever
paid).

s5 Prizes and draw. Prizes are fixed when the week opens. Typical week: 2 x $25 + 5 x $10 digital gift
cards + 1 merch item, about $120 ARV. Gift cards by email as digital codes; merch ships free in the US.
Odds per drum = your coins in it / all coins in it; the app shows live counts. Winners drawn at the
Close from each drum with a published seed (e.g. the week's last NFL final) so anyone can reproduce the
shuffle; seed, coin count and player count are published per drum. One coin wins one prize; a winning
coin is removed before the next prize in that drum. No transfer, no cash alternative; equal-or-greater
substitution allowed.

s6 Notification and fulfilment. Winners told in app, by push and by email at the Close; every drum's
results are posted in The Drum. Before a FIRST prize: legal name, email, state, 18+ confirmation (+ US
shipping address for merch). No confirmation within 14 days, false info or ineligible = forfeit, and the
prize may be redrawn from the same drum. Gift cards via a third-party rewards platform within 7 business
days of verification; merch within 21 days. $600+ in a calendar year: W-9 before further prizes, 1099
issued.

s7 Conduct. Coins from cheating, collusion, multiple accounts, bots or ToS breach can be voided; coins
from a contest voided under its own rules are never minted. A drawing that cannot run at the Close runs
when fixed, with coins as they stood at the Close. A cancelled week's coins go into the next drawing.
Winners' handle and STATE may be posted; winners list shown 90 days. California law. [PRIVACY POLICY
URL], [CONTACT EMAIL].

## The mock, screen by screen

1. Play tab, coin strip (Main). Navy card under the wordmark: lime SV coin, "4 COINS THIS WEEK", "2 in
   the drum · 2 not dropped yet", right side "DRAWING TUE" + "9:00 am PT · 1d 14h". Taps to The Drum.
   Game rows below carry coin hints ("top 10% earns 3 coins", "+1", "1 coin banked"). The tab bar gains
   a COINS tab (PLAY / SCORES / COINS / MARKET / LEAGUES).
2. The Drum (Drum). Back, "THE DRUM", Rules link. Navy header: "WEEK 7 · DRAWN TUE 9:00 AM PT",
   "Closes in 1d 14h. Coins still in your hand at close drop into the $10 drum for you.", lime IN HAND
   count. "DROP YOUR 4 COINS - All in one drum, or spread them". One card per prize: tile ($25 / $10 /
   CAP), "2 × $25 GIFT CARDS", "Amazon · 212 coins in · about 1 in 107 per coin", your coins as SV chips
   + "N of yours here", -/+ stepper (44 px). "HOW YOU EARNED THEM" list (Showed up +1, Daily top 25% +2,
   Pick'em 11 of 13 +1, Weekly pending "+3?"). Small print: no cash value, one coin one entry, Tue 9:00
   am PT, push and email, US 18+, Official rules link. Sticky bottom bar: "$25 drum 2 · $10 drum 1 · Cap
   1", "0 left in hand", lime "DROP 4 COINS".
3. Confirm drop (Drop). Bottom sheet over the dimmed Drum: "WEEK 7 · DROPPING 4 COINS", "YOUR DROP",
   "Once they're in, they stay in. Drawn Tuesday 9:00 am PT." One row per drum with odds and count. Note:
   coins earned after this land back in hand; drop before Tue 9:00 am PT or they go in the $10 drum.
   "DROP THEM" (lime) and "Change it".
4. Tuesday reveal (Tuesday). Navy result card: "WEEK 7 · DRAWN TUE 9:00 AM PT", "NOT THIS WEEK" (or the
   win), odds line, "START WEEK 8". "WEEK 7 WINNERS" by prize: handle, coins in, place. "THE DRAW, SHOWN":
   coins in all drums 726, players entered 268, seed "MNF final · DET 27 · SEA 20", "Each coin is one
   ticket... anyone can rerun the draw... Check it". "Week 8 drum is open · drawn Tue Oct 27".

Look: white ground, navy #1A1650, lime #D4FF00, panel #F6F6F3, line #E6E5EE, Rubik + Rubik Mono One.

## Where the mock and the rules disagree (open for Derik)

- Mock coin hints count whole coins per finish ("top 10% earns 3 coins", Daily top 25% "+2", Pick'em
  "+1"); the rules pay POINTS (top 25% = 50 = half a coin; top 10% = 100 + 25 settled = 1.25 coins).
  Build follows the rules' point table; copy shows points or "N points to next coin".
- Mock winners show a city ("San Diego, CA"); the rules allow handle and STATE only. Build shows state.
- Rules exclude 13-17 coins from the draw; the brief's auto-drop drops every in-hand coin. Build: minors
  earn and see coins but are never entered (no drop, no auto-drop) until 18+ is known.
- Rules s7 carries a cancelled week's coins into the next drawing; s4 says coins never carry. Only the
  cancellation path carries.
- Rules give no deadline for "Pick'em 10+ correct banks a coin" (mock); not in the point table, not built.

## Build order (Part B, after GO)

B1 migration (coin_weeks, arcade_points, coin_mint, drum_prizes, drum_entries, drum_winners; coins in
hand = minted - dropped, never stored) · B2 lib/coins/meter.js on each settlement path · B3 /coins The
Drum + POST /api/coins/drop (no un-drop) · B4 Play strip + meter bar · B5 Tue 09:00 PT close job
(auto-drop, NFL-final seed, seeded shuffle, winners, next week, push + email, /coins/results/<week>,
dry run) · B6 verification sheet, Tremendous sandbox, merch queue, $600 W-9 flag · B7 /coins/rules.
Flag COINS=on in Preview first; merge flag-off; production flip on Derik's GO.
