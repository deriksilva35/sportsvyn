// lib/gridiron/situation.test.mjs - the situation NOW, the one derivation the
// Live Activity, the Scores card and the gamecast headline read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situationNow, afterSnap } from './situation.js';
import { afterSnap as reExported } from '../push/liveActivityState.js';

const pl = (o) => ({ period: 3, clock: '9:00', offenseTeamId: 7, playType: 'Rush', yardsGained: 0, text: 'play', ...o });

test('situationNow is afterSnap of the last play, with the snap\'s offense', () => {
  assert.equal(reExported, afterSnap, 'the Live Activity module hands out the same function');
  assert.deepEqual(situationNow([pl({ down: 3, distance: 3, yardsToGoal: 38, playType: 'Pass Incompletion' })]),
    { down: 4, distance: 3, yardsToGoal: 38, offenseTeamId: 7 });
  assert.equal(situationNow([]), null);
});

test('A CFB TIMEOUT IS A STOPPAGE, spelled the way CFB spells it ("Timeout", "End Period" - measured on PROD 26 Sep)', () => {
  const run = pl({ clock: '9:00', down: 2, distance: 5, yardsToGoal: 40, yardsGained: 3 });
  for (const t of ['Timeout', 'timeout', 'official-timeout', 'Two Minute Warning']) {
    const got = situationNow([run, pl({ clock: '8:55', playType: t, down: 3, distance: 2, yardsToGoal: 0, text: 'Timeout ALA' })]);
    if (t === 'Two Minute Warning') { assert.deepEqual(got, { down: 3, distance: 2, yardsToGoal: 37, offenseTeamId: 7 }); continue; }
    assert.deepEqual(got, { down: 3, distance: 2, yardsToGoal: 37, offenseTeamId: 7 }, `${t}: the timeout does not blank the line`);
  }
  // the end of the half still does, in either spelling
  for (const t of ['End of Half', 'end-of-half']) {
    assert.equal(situationNow([pl({ period: 2, clock: '0:02', down: 1, distance: 10, yardsToGoal: 60 }), pl({ period: 2, clock: '0:00', playType: t, down: null, distance: null, yardsToGoal: null })]), null, t);
  }
});

test('the gamecast headline with nothing to name is the dash, and no ball is drawn', async () => {
  const { install } = await import('../testing/nextResolve.mjs');
  install();
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { DriveStrip } = await import('../../components/gridiron/Gamecast.js');
  const html = renderToStaticMarkup(React.createElement(DriveStrip, {
    state: { mode: 'live', period: 2, lastPlay: pl({ down: 3, distance: 3, yardsToGoal: 38 }) },
    lastPlay: pl({ down: 3, distance: 3, yardsToGoal: 38 }), now: null,
    drive: null, homeAbbr: 'ALA', awayAbbr: 'USF', offenseAbbr: 'ALA', defenseAbbr: 'USF', simulated: false,
  }));
  assert.match(html, /class="ds-dd">—</);
  assert.doesNotMatch(html, /ds-ball/);
  assert.doesNotMatch(html, /3rd &amp; 3/, 'never the snap of the play that already happened');
});
