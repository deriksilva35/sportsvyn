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
  // 084: the card hands the strip its size, the reader's own team and (ruling
  // 2 Sep) each franchise's keeper count for the pills.
  // RE-PINNED (085, league sharing): this pinned defaultSeat={(l.teams ?? [])
  // .find((t) => t.isMine === true)?.slot ?? null} - the IMPORTER's team, read
  // off the config's jsonb, which is the same seat for everyone who can see
  // the card. A shared card has members, and a member's default is the
  // franchise THEY claimed (draft_config_members.fantrax_team_id), resolved
  // server-side by defaultSeatFor into l.default_seat: the claimed column, or
  // the owner's isMine seat, or null for an unclaimed member.
  assert.match(strip, /<LeagueStart\s+configId=\{l\.id\}\s+teamsCount=\{l\.teams_count\}\s+defaultSeat=\{l\.default_seat \?\? null\}\s+keptBySeat=\{l\.kept_by_seat \?\? null\}/);
  assert.doesNotMatch(strip, /isMine === true/, 'the card no longer derives the seat from the importer\'s flag');
  // The second half of the card (085): members, the invite, the league's mocks.
  assert.match(strip, /<LeagueShare\s+configId=\{l\.id\}\s+role=\{l\.role\}\s+members=\{l\.members \?\? \[\]\}\s+invite=\{l\.invite \?\? null\}\s+mocks=\{l\.mocks \?\? \[\]\}\s+myUserId=\{userId\}/);
  assert.match(src('app/sim/page.js'), /<MyLeagues leagues=\{myLeagues\} userId=\{userId\} \/>/);
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

test('seat strip: the league card alone; a pill is a franchise with its keeper count; the tracker keeps its plain seat field', () => {
  const stripSrc = stripComments(src('components/sim/SeatStrip.js'));
  const tracker = stripComments(src('components/sim/TrackerStart.js'));
  assert.match(stripSrc, /role="radiogroup"/);
  assert.match(stripSrc, /className=\{`seatpill\$\{on \? ' on' : ''\}\$\{dflt \? ' dflt' : ''\}`\}/);
  // A pill says what taking that team hands you: "12 · 4 kept".
  assert.match(stripSrc, /\{counts \? `\$\{s\} · \$\{counts\[s - 1\] \?\? 0\} kept` : s\}/);
  assert.match(start, /<SeatStrip\s+teams=\{teamsCount\}\s+seat=\{seat\}\s+defaultSeat=\{defaultSeat\}/);
  // RE-PINNED (ruling 2 Sep, seat = franchise): this pinned hint="Draft from
  // any spot - this run only." - a chair. The seat is a team now, and the copy
  // says so; the pills carry the league's per-team keeper counts.
  assert.match(start, /label="YOUR TEAM"/);
  assert.match(start, /hint="Draft as any team - this run only\."/);
  assert.match(start, /counts=\{keptBySeat\}/);
  assert.doesNotMatch(start, /any spot/);
  assert.match(start, /Start draft · seat \$\{seat\}/);
  // RE-PINNED TWICE (ruling 2 Sep, tracker picker removed). 084 put the strip
  // on the tracker and pinned `<select value={seat}` GONE; the label ruling
  // then pinned "YOUR COLUMN ON THE BOARD". Both are void: the tracker seat is
  // a transcription fact, so it is the plain YOUR SEAT select in the setup row
  // again (as at 78f402b), and the strip is the league card's alone.
  assert.doesNotMatch(tracker, /SeatStrip/, 'no seat picker on the tracker');
  assert.doesNotMatch(tracker, /YOUR COLUMN ON THE BOARD|this run only|Draft as any team/);
  assert.match(tracker, /<span>YOUR SEAT<\/span>\s*<select value=\{seat\} onChange=\{\(e\) => setSeat\(Number\(e\.target\.value\)\)\}>/);
  assert.match(tracker, /startTrackerDraft\(config, seat, labels\)/, 'the tracker still sends the seat as pickPosition');
  assert.equal((src('components/sim/SeatStrip.js').match(/Tracker/g) ?? []).length, 1, 'SeatStrip names the Tracker once - to say it is not there');
  assert.match(css, /\.seatpill\.on \{ background: var\(--volt\);/);
  assert.match(css, /\.seatpill\.dflt \{ border-color: var\(--muted\); \}/);
});

test('flow-core (seat = franchise): the column is the league\'s, keepers load with no run argument, the roster and minors follow the franchise', () => {
  const core = stripComments(src('lib/fantasy/drafts.js'));
  const seed = stripComments(src('lib/fantrax/keeperSeed.js'));
  // RE-PINNED (ruling 2 Sep). This pinned the per-run seating: runSeats(config.teams, seat),
  // loadKeepers(config, pos|draft.pick_position) x6 and 0 seatless loads, chosenSeat,
  // minors by isMine (the reader's, because the seat could be borrowed). All of that
  // moved keepers between columns per run. Now: the OLD derivation is ABSENT -
  assert.doesNotMatch(seed, /runSeats/, 'no per-run seating in keeperSeed');
  assert.doesNotMatch(core, /runSeats/, 'no per-run seating in the flow-core');
  assert.doesNotMatch(core, /chosenSeat/);
  assert.equal((core.match(/loadKeepers\(config, /g) ?? []).length, 0, 'no keeper load takes a seat');
  assert.equal((core.match(/await loadKeepers\(config\)/g) ?? []).length, 6, 'every keeper load is the league\'s map');
  assert.match(core, /leagueSeats\(config\.teams\)/);
  assert.match(seed, /export function leagueSeats\(teams\)/);
  // The seat is range-checked and defaults to the reader's own team; user_seat = the franchise, always written.
  // RE-PINNED (085): this pinned `let seat = mine.slot;` - the importer's isMine
  // team as everyone's default. The default is now the CALLER's franchise
  // (defaultSeatFor: claimed column -> owner's isMine -> null), and a null
  // default with no opts.seat is still 'no_seat'.
  assert.match(core, /const dflt = defaultSeatFor\(config, membership/);
  assert.match(core, /if \(dflt == null && opts\.seat == null\) return \{ ok: false, reason: 'no_seat' \};/);
  assert.match(core, /let seat = dflt;/);
  assert.doesNotMatch(core, /let seat = mine\.slot;/);
  assert.match(core, /if \(!Number\.isInteger\(s\) \|\| s < 1 \|\| s > config\.teams_count\) return \{ ok: false, reason: 'bad_seat' \};/);
  // RE-PINNED (085): this pinned finalizeStart(config, seat, ...) - the config
  // as loaded, whose user_id is the IMPORTER. finalizeStart writes that column
  // as the run's owner, so a member's run landed on the owner's account; the
  // caller is spread over it now, as the preset path has always done.
  assert.match(core, /finalizeStart\(\{ \.\.\.config, user_id: userId \}, seat, \{ \.\.\.opts, franchise: true \}/);
  assert.doesNotMatch(core, /finalizeStart\(config, seat, /);
  assert.match(core, /const userSeat = opts\.franchise === true \? pos : null;/);
  assert.match(core, /INSERT INTO drafts \(user_id, config_id, status, pick_position, user_seat, is_auto,/);
  // The room: the franchise is the team at pick_position; its minors, its name.
  assert.match(core, /const franchise = \(config\.teams \?\? \[\]\)\.find\(\(t\) => Number\(t\.slot\) === draft\.pick_position\) \?\? null;/);
  assert.match(core, /const minors = franchise\?\.minors \?\? \[\];/);
  assert.doesNotMatch(core, /isMine === true\)\?\.minors/, 'minors are the franchise\'s, not the reader\'s');
  // The roster tab follows the franchise: pending keepers in the YOU column, and the header names the team.
  assert.match(room, /pendingKeepers\.filter\(\(k\) => k\.teamSlot === userTeamIndex \+ 1\)/);
  assert.match(room, /My roster · Seat \{userTeamIndex \+ 1\}\{franchise\?\.name/);
  assert.match(room, /franchise\.isMine \? ' \(your team\)' : ''/);
  assert.match(src('app/sim/draft/[id]/page.js'), /franchise=\{room\.franchise \?\? null\}/);
  // The tracker's seat is always chosen, so it writes user_seat = pick_position.
  assert.match(core, /INSERT INTO drafts \(user_id, config_id, status, pick_position, user_seat, is_auto, mode, team_labels,/);
  // The leagues list carries each franchise's keeper count for the pills.
  assert.match(core, /kept_by_seat: l\.keeper_count > 0 \? keptBySeat\(/);
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
