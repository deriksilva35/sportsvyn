// THE TWO ROUND WORDS (ruling thu-36): "Matchweek N" on the football surfaces
// (/scores, the EPL match pages, /epl/standings, the league-week crumbs),
// "Gameweek N" / "GW N" inside EPL Weekly 5. One source each
// (lib/soccer/roundLabel.js), and no file spells either word by hand - so the
// two cannot drift into each other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchweekLabel, gameweekLabel, gameweekShort } from './roundLabel.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(path.join(REPO, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(REPO, rel)).isDirectory()) { if (name !== 'node_modules' && !name.startsWith('.')) walk(rel, out); continue; }
    if (/\.(js|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(rel);
  }
  return out;
}

test('the labels', () => {
  assert.equal(matchweekLabel(6), 'Matchweek 6');
  assert.equal(gameweekLabel(6), 'Gameweek 6');
  assert.equal(gameweekShort(6), 'GW 6');
  assert.equal(matchweekLabel(null), null);
});

test('no file spells "Matchweek " or "Gameweek " by hand - only roundLabel.js', () => {
  const bad = [];
  for (const f of ['app', 'components', 'lib'].flatMap((d) => walk(d))) {
    if (f === 'lib/soccer/roundLabel.js') continue;
    const c = code(read(f));
    for (const m of c.matchAll(/\b(Matchweek|Gameweek|MATCHWEEK|GAMEWEEK) /g)) bad.push(`${f}: ${c.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, ' ')}`);
  }
  assert.deepEqual(bad, [], `hand-typed round words:\n${bad.join('\n')}`);
});

test('the football surfaces print Matchweek through matchweekLabel', () => {
  for (const f of ['app/epl/match/[slug]/page.js', 'components/soccer/EplTableArcade.js', 'components/gridiron/Scoreboard.js',
    'components/match/MatchMetaStrip.js', 'lib/soccer/eplPageArcade.js', 'lib/gridiron/leagueWeek.js']) {
    const t = read(f);
    assert.match(t, /matchweekLabel\(/, `${f} uses matchweekLabel`);
    assert.doesNotMatch(t, /gameweek/i, `${f} never says gameweek`);
  }
});

test('EPL Weekly 5 says Gameweek, and never Matchweek', () => {
  const files = [...walk('lib/eplWeekly5'), ...walk('components/eplWeekly5'), ...walk('app/epl-weekly-5'), 'app/api/cron/epl-weekly-5/route.js'];
  for (const f of files) assert.doesNotMatch(code(read(f)), /matchweek/i, `${f} never says matchweek`);
  assert.match(read('lib/eplWeekly5/rules.js'), /export const roundLabel = \(week\) => gameweekLabel\(week\)/);
  assert.match(read('lib/eplWeekly5/rules.js'), /export const roundShort = \(week\) => gameweekShort\(week\)/);
});
