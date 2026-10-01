// lib/draft/matchup.test.mjs - this week's opponent on a pick-list row (thu-25).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weekMatchups, oppLabel, matchupFor } from './matchup.js';
import { standaloneTimeLabel } from '../time/standaloneLabel.js';

// weekTeamGames' own shape: one entry per team, oriented to that team.
const GAMES = new Map([
  ['BUF', { status: 'scheduled', opp: 'KC', home: false, kickoffAt: new Date('2026-10-11T17:00:00Z') }],
  ['KC', { status: 'scheduled', opp: 'BUF', home: true, kickoffAt: new Date('2026-10-11T17:00:00Z') }],
  ['DAL', { status: 'scheduled', opp: 'NYG', home: true, kickoffAt: '2026-10-12T00:20:00.000Z' }],
  ['NYG', { status: 'scheduled', opp: null, home: false, kickoffAt: null }], // nothing to name
]);

test('weekMatchups: plain, serialisable, oriented to the keyed team', () => {
  const m = weekMatchups(GAMES);
  assert.deepEqual(m.BUF, { opp: 'KC', home: false, kickoffAt: '2026-10-11T17:00:00.000Z' });
  assert.deepEqual(m.KC, { opp: 'BUF', home: true, kickoffAt: '2026-10-11T17:00:00.000Z' });
  assert.equal(m.DAL.kickoffAt, '2026-10-12T00:20:00.000Z');
  assert.equal(m.NYG, undefined, 'an entry with no opponent is not a matchup');
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m, 'crosses the server/client line intact');
});

test('a practice mock (no games map) has no matchups at all - null, not {}', () => {
  assert.equal(weekMatchups(null), null);
  assert.equal(weekMatchups(undefined), null);
  assert.equal(weekMatchups(new Map()), null);
});

test('oppLabel: "@KC" away, "vs KC" at home, null with no game', () => {
  const m = weekMatchups(GAMES);
  assert.equal(oppLabel(m.BUF), '@KC');
  assert.equal(oppLabel(m.KC), 'vs BUF');
  assert.equal(oppLabel(null), null);
  assert.equal(oppLabel({ opp: null }), null);
});

test('matchupFor: by the player\'s team; no week, no team, or a bye is null', () => {
  const m = weekMatchups(GAMES);
  assert.equal(matchupFor(m, 'BUF').opp, 'KC');
  assert.equal(matchupFor(m, 'SF'), null, 'a team on bye');
  assert.equal(matchupFor(m, null), null);
  assert.equal(matchupFor(null, 'BUF'), null, 'a practice mock');
});

test('the kickoff reads in the viewer\'s zone through the site formatter: "Sun 1:00 PM"', () => {
  const iso = weekMatchups(GAMES).BUF.kickoffAt;
  // What StandaloneTime renders with weekday and no zone suffix - ET on the
  // server's first paint, then the device's zone by name after mount.
  assert.equal(standaloneTimeLabel(iso, { weekday: true, zone: false }), 'Sun 1:00 PM');
  assert.equal(standaloneTimeLabel(iso, { weekday: true, zone: false, tz: 'America/Los_Angeles' }), 'Sun 10:00 AM');
  // A Sunday-night ET kickoff is still SUNDAY in Los Angeles, but Monday in UTC.
  const snf = weekMatchups(GAMES).DAL.kickoffAt;
  assert.equal(standaloneTimeLabel(snf, { weekday: true, zone: false }), 'Sun 8:20 PM');
  assert.equal(standaloneTimeLabel(snf, { weekday: true, zone: false, tz: 'America/Los_Angeles' }), 'Sun 5:20 PM');
});

test('the room renders it through StandaloneTime and the server hands it over from the ranked window', () => {
  const room = readFileSync(new URL('../../components/sim/DraftRoom.js', import.meta.url), 'utf8');
  assert.match(room, /import StandaloneTime from '@\/components\/StandaloneTime'/);
  assert.match(room, /<StandaloneTime iso=\{mu\.kickoffAt\} weekday zone=\{false\} \/>/);
  assert.doesNotMatch(room, /toLocale(Time|Date)?String/, 'no second formatter in the room');
  const drafts = readFileSync(new URL('../fantasy/drafts.js', import.meta.url), 'utf8');
  assert.match(drafts, /matchups: weekMatchups\(rankedWindow\?\.gamesByTeam\)/);
  const page = readFileSync(new URL('../../app/sim/draft/[id]/page.js', import.meta.url), 'utf8');
  assert.match(page, /matchups=\{room\.matchups \?\? null\}/);
});
