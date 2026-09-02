// components/sim/myLeagues.test.mjs - the imported-league strip has no dead link.
//
// Stage 3 shipped the strip with `<Link href={`/sim/league/${l.id}`}>`, a route
// that does not exist. Stage 3B replaced it with the real start action. This
// pins that: the served surface starts the draft, and nothing on it points at
// a page the app does not have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const strip = stripComments(src('components/sim/MyLeagues.js'));
const start = stripComments(src('components/sim/LeagueStart.js'));
const actions = stripComments(src('app/actions/sim.js'));
const room = stripComments(src('components/sim/DraftRoom.js'));
const css = src('components/sim/sim.css');

test('MyLeagues has no /sim/league/ link and no route for one exists', () => {
  assert.equal((strip.match(/sim\/league\//g) ?? []).length, 0, 'no link into /sim/league/');
  assert.equal((strip.match(/<Link/g) ?? []).length, 0, 'the card is not a link at all');
  assert.ok(!existsSync(path.join(REPO, 'app/sim/league')), 'no app/sim/league route');
  // 084: the card hands the strip its size and the imported seat (isMine).
  assert.match(strip, /<LeagueStart\s+configId=\{l\.id\}\s+teamsCount=\{l\.teams_count\}\s+defaultSeat=\{\(l\.teams \?\? \[\]\)\.find\(\(t\) => t\.isMine === true\)\?\.slot \?\? null\}/);
});

test('LeagueStart calls the server action and lands in the room route; the default seat is sent as NO seat', () => {
  // RE-PINNED (084): this pinned `startLeagueDraft(configId, {})` - the card had
  // no seat to send. Now the default seat still sends {} (a run from your own
  // seat is the start it was), and only a tap away from it sends { seat }.
  assert.match(start, /const opts = defaultSeat != null && seat === defaultSeat \? \{\} : \{ seat \};/);
  assert.match(start, /startLeagueDraft\(configId, opts\)/);
  assert.match(start, /router\.push\(`\/sim\/draft\/\$\{res\.draftId\}`\)/);
  assert.match(start, /\/signin\?callbackUrl=\/sim/);
  assert.match(start, /bad_seat: 'Pick a seat between 1 and the league size\.'/);
  assert.match(actions, /export async function startLeagueDraft\(configId, opts = \{\}\)/);
  // The action whitelists the wire: auto and seat, nothing else reaches the flow-core.
  assert.match(actions, /const clean = \{ auto: opts\?\.auto === true, \.\.\.\(opts\?\.seat != null \? \{ seat: Number\(opts\.seat\) \} : \{\}\) \};/);
  assert.match(actions, /startLeagueDraftFor\(userId, Number\(configId\), clean\)/);
});

test('084 seat strip: one control on both start surfaces; the league default is marked, the tracker names the column', () => {
  const stripSrc = stripComments(src('components/sim/SeatStrip.js'));
  const tracker = stripComments(src('components/sim/TrackerStart.js'));
  assert.match(stripSrc, /role="radiogroup"/);
  assert.match(stripSrc, /className=\{`seatpill\$\{on \? ' on' : ''\}\$\{dflt \? ' dflt' : ''\}`\}/);
  assert.match(start, /<SeatStrip\s+teams=\{teamsCount\}\s+seat=\{seat\}\s+defaultSeat=\{defaultSeat\}/);
  assert.match(start, /hint="Draft from any spot - this run only\."/);
  assert.match(start, /Start draft · seat \$\{seat\}/);
  assert.match(tracker, /<SeatStrip\s+teams=\{teams\}\s+seat=\{seat\}\s+onChange=\{setSeat\}/);
  // RE-PINNED (ruling 2 Sep): this pinned hint="Your column on the board - this
  // run only." The tracker's seat is a transcription fact - where you sit in
  // your real league's draft - not a preference, so the label says so and
  // "this run only" belongs to Mock alone.
  assert.match(tracker, /label="YOUR COLUMN ON THE BOARD"/);
  assert.match(tracker, /hint="Pick where your live league drafts from\."/);
  assert.doesNotMatch(tracker, /this run only/, 'the tracker never says this run only');
  assert.doesNotMatch(tracker, /<select value=\{seat\}/, 'the tracker\'s seat <select> is gone');
  assert.match(tracker, /startTrackerDraft\(config, seat, labels\)/, 'the tracker still sends the seat as pickPosition');
  assert.match(css, /\.seatpill\.on \{ background: var\(--volt\);/);
  assert.match(css, /\.seatpill\.dflt \{ border-color: var\(--muted\); \}/);
});

test('084 flow-core: default seat is the imported one, a chosen seat is range-checked, user_seat records only a choice, keepers load by the draft\'s seat', () => {
  const core = stripComments(src('lib/fantasy/drafts.js'));
  assert.match(core, /let seat = mine\.slot; let chosenSeat = false;/);
  assert.match(core, /if \(!Number\.isInteger\(s\) \|\| s < 1 \|\| s > config\.teams_count\) return \{ ok: false, reason: 'bad_seat' \};/);
  assert.match(core, /finalizeStart\(config, seat, \{ \.\.\.opts, chosenSeat \}/);
  assert.match(core, /const userSeat = opts\.chosenSeat === true \? pos : null;/);
  assert.match(core, /INSERT INTO drafts \(user_id, config_id, status, pick_position, user_seat, is_auto,/);
  // Every keeper load derives from the run's seat - none from the config alone.
  assert.equal((core.match(/loadKeepers\(config\)/g) ?? []).length, 0, 'no seatless keeper load');
  assert.equal((core.match(/loadKeepers\(config, (draft\.pick_position|pos)\)/g) ?? []).length, 6);
  assert.match(core, /runSeats\(config\.teams, seat\)/);
  // Minors are the reader's (isMine), not the seat's - the seat may be borrowed this run.
  assert.match(core, /find\(\(t\) => t\.isMine === true\)\?\.minors \?\? \[\]/);
  assert.doesNotMatch(core, /t\.slot === draft\.pick_position\)\?\.minors/);
  // The tracker's seat is always chosen, so it writes user_seat = pick_position.
  assert.match(core, /INSERT INTO drafts \(user_id, config_id, status, pick_position, user_seat, is_auto, mode, team_labels,/);
  // Import: owner written, provider seating checked, one keeper per owner per round.
  const imp = stripComments(src('lib/fantrax/import.js'));
  assert.match(imp, /INSERT INTO draft_config_keepers \(config_id, fantrax_team_id, team_slot, round, pick_in_round,/);
  assert.doesNotMatch(imp, /ON CONFLICT \(config_id, round, pick_in_round\) DO NOTHING/, 'a collision is a refusal, not a silent skip');
  assert.match(imp, /reason: 'keeper_seat_conflict'/);
  assert.match(imp, /reason: 'keeper_round_collision'/);
});

test('room: minors render as a muted section under the roster; a nameless entry is position + Devy', () => {
  assert.match(room, /className="rminors-h">Minors · \{/);
  assert.match(room, /m\.name \?\? `\$\{m\.position\} · Devy`/);
  assert.match(room, /m\.alsoKeeper \? <span className="tm"> · kept<\/span> : null/);
});

// ---- Stage 5: the room renders the shelf ----------------------------------
test('board: an unmade keeper cell renders muted with a KEEPER tag, outranks CLOCK, and a committed keeper keeps its marker', () => {
  const fn = room.slice(room.indexOf('function BoardCell'));
  const at = (n) => { const i = fn.indexOf(n); assert.ok(i > -1, `${n} present`); return i; };
  assert.ok(at('if (cell.keeper && !cell.pick)') < at('if (cell.onClock)'), 'keeper branch precedes the clock branch');
  assert.ok(at('if (cell.onClock)') < at('if (!cell.pick)'), 'clock precedes empty');
  assert.match(fn, /className=\{`bc kp \$\{posClass\(kpos\)\}/);
  assert.match(fn, /\{kpos\} · KEEPER/);
  assert.match(fn, /cell\.pick\.isKeeper \? ' · KEPT' : ''/);
  assert.match(css, /\.bg2 \.bc\.kp \{ opacity: \.55;/);
});

test('roster: kept players render pre-commit as kept · R<n>, counted apart from drafted; pending list drops a landed overall', () => {
  assert.match(room, /buildRoster\(userPicks, config\.roster_slots, myPendingKeepers\)/);
  assert.match(room, /\{draftedCount\} drafted \+ \{keptCount\} kept/);
  assert.match(room, /kept · R\{s\.kept\.round\}/);
  assert.match(room, /kept · R\{s\.pick\.round\}/);
  assert.match(room, /\(upcomingKeepers \?\? \[\]\)\.filter\(\(k\) => !made\.has\(k\.overall\)\)/);
  assert.match(room, /keepers: pendingKeepers/);
  // The pick tab is untouched: nothing offers a pending keeper (available is server-filtered).
  assert.equal((room.match(/pendingKeepers/g) ?? []).length, 5, 'declared once, filtered into myPendingKeepers (2), board ctx + deps (2) - nothing else');
});
