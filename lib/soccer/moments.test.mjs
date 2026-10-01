// lib/soccer/moments.test.mjs - goals and sendings-off from match_events (thu-24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentsFromEvents, surname, minuteText, sideLines, cardMoments, momentList } from './moments.js';

// Everton 1-0 Ipswich (20 Sep) and Man City 5-3 Sunderland, as match_events rows.
const ev = (minute, event_type, detail, team_side, player_name, o = {}) => ({ minute, minute_extra: null, event_type, detail, team_side, player_name, assist_name: null, is_current: true, ...o });
const EVE_IPS = [
  ev(11, 'Goal', 'Normal Goal', 'home', 'T. Barry', { assist_name: 'J. Tarkowski' }),
  ev(35, 'Card', 'Yellow Card', 'away', 'Abdul Fatawu Issahaku'),
  ev(67, 'Card', 'Yellow Card', 'away', 'Abdul Fatawu Issahaku'),
  ev(67, 'Card', 'Red Card', 'away', 'Abdul Fatawu Issahaku'),
];

test('goals and reds: a second yellow is ONE sending-off; a cancelled goal (is_current false) and a missed penalty are not goals', () => {
  const m = momentsFromEvents([...EVE_IPS, ev(40, 'Goal', 'Normal Goal', 'away', 'X', { is_current: false }), ev(80, 'Goal', 'Missed Penalty', 'home', 'Y')]);
  assert.deepEqual(m.goals, [{ minute: 11, extra: null, side: 'home', player: 'T. Barry', assist: 'J. Tarkowski', kind: 'goal' }]);
  assert.deepEqual(m.reds, [{ minute: 67, extra: null, side: 'away', player: 'Abdul Fatawu Issahaku' }]);
  const so = momentsFromEvents([ev(120, 'Goal', 'Penalty', 'home', 'Z', { comments: 'Penalty Shootout' })]);
  assert.equal(so.goals.length, 0);
});

test('surnames and minutes', () => {
  assert.equal(surname('T. Barry'), 'Barry');
  assert.equal(surname('J. P. van Hecke'), 'van Hecke');
  assert.equal(surname('Abdul Fatawu Issahaku'), 'Issahaku');
  assert.equal(minuteText(90, 4), "90+4'");
  assert.equal(minuteText(11, null), "11'");
});

test('the card: one line per scorer with every minute, (OG) and (P) marked, then the reds', () => {
  const m = momentsFromEvents([
    ev(12, 'Goal', 'Normal Goal', 'away', 'B. Brobbey'), ev(33, 'Goal', 'Normal Goal', 'away', 'B. Brobbey'),
    ev(59, 'Goal', 'Normal Goal', 'away', 'B. Brobbey'), ev(63, 'Goal', 'Own Goal', 'home', 'Lisandro Martínez'),
    ev(45, 'Goal', 'Penalty', 'home', 'E. Haaland', { minute_extra: 2 }),
  ]);
  assert.deepEqual(sideLines(m, 'away').map((l) => l.text), ["Brobbey 12', 33', 59'"]);
  assert.deepEqual(sideLines(m, 'home').map((l) => l.text), ["Haaland 45+2' (P)", "Martínez 63' (OG)"]);
  assert.equal(cardMoments({ goals: [], reds: [] }), null, 'a goalless game with no reds draws nothing');
  const c = cardMoments(momentsFromEvents(EVE_IPS));
  assert.deepEqual(c.home.map((l) => l.text), ["Barry 11'"]);
  assert.deepEqual(c.away.map((l) => [l.kind, l.text]), [['red', "Issahaku 67'"]]);
});

test('the page list: match order, the running score on goals, the assist named', () => {
  const l = momentList(momentsFromEvents(EVE_IPS), { homeAbbr: 'EVE', awayAbbr: 'IPS' });
  assert.deepEqual(l, [
    { kind: 'goal', side: 'home', when: "11'", abbr: 'EVE', text: 'Barry - Goal (Tarkowski)', score: 'EVE 1 - IPS 0' },
    { kind: 'red', side: 'away', when: "67'", abbr: 'IPS', text: 'Issahaku - Red card', score: null },
  ]);
});
