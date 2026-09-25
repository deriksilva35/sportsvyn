// lib/teams/headgear.test.mjs - the one reader for a team's cutout, and the
// list it answers from held to the files on disk in both directions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { HEADGEAR, headgearFor, headgearFile, pairHasHeadgear } from './headgear.js';

const PUBLIC = new URL('../../public/headgear/', import.meta.url);

test('nfl and mlb are found, with both densities', () => {
  assert.deepEqual(headgearFor('nfl', 'GB'), { src1x: '/headgear/nfl/GB@1x.webp', src2x: '/headgear/nfl/GB@2x.webp' });
  assert.deepEqual(headgearFor('mlb', 'NYY'), { src1x: '/headgear/mlb/NYY@1x.webp', src2x: '/headgear/mlb/NYY@2x.webp' });
});

test('THE ATL COLLISION resolves by league: the Falcons and the Braves are two files', () => {
  const nfl = headgearFor('nfl', 'ATL'); const mlb = headgearFor('mlb', 'ATL');
  assert.equal(nfl.src1x, '/headgear/nfl/ATL@1x.webp'); assert.equal(mlb.src1x, '/headgear/mlb/ATL@1x.webp');
  assert.notEqual(nfl.src1x, mlb.src1x);
  const bytes = (u) => readFileSync(new URL(`.${u.slice('/headgear'.length)}`, PUBLIC));
  assert.equal(bytes(nfl.src2x).equals(bytes(mlb.src2x)), false, 'and the two files differ');
  // The other shared abbreviations get the same treatment.
  for (const a of ['ARI', 'BAL', 'CIN', 'CLE', 'DET', 'HOU', 'KC', 'MIA', 'MIN', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'WSH']) {
    assert.notEqual(headgearFor('nfl', a).src1x, headgearFor('mlb', a).src1x, a);
  }
});

test('an unknown league, no league and a missing file are all null', () => {
  assert.equal(headgearFor('cfb', 'ATL'), null, 'letters that exist elsewhere do not leak across leagues');
  assert.equal(headgearFor('epl', 'ARS'), null);
  assert.equal(headgearFor(null, 'ATL'), null); assert.equal(headgearFor(undefined, 'ATL'), null);
  assert.equal(headgearFor('nfl', 'ZZZ'), null);
  assert.equal(headgearFor('nfl', null), null); assert.equal(headgearFor('nfl', 'atl'), null, 'the stored key, exactly');
  assert.equal(headgearFor('hasOwnProperty', 'ATL'), null, 'no prototype key is a league');
  assert.equal(headgearFor('mlb', 'NYJ'), null, 'an nfl key is not an mlb one');
});

test('BOTH OR NEITHER: a pair has headgear only when both sides do', () => {
  assert.equal(pairHasHeadgear('nfl', 'ATL', 'GB'), true);
  assert.equal(pairHasHeadgear('nfl', 'ATL', 'ZZZ'), false);
  assert.equal(pairHasHeadgear('nfl', null, 'GB'), false);
  assert.equal(pairHasHeadgear('cfb', 'ALA', 'UGA'), true, 'two FBS sides');
  assert.equal(pairHasHeadgear('cfb', 'ALA', null), false, 'an FCS side has no stored letters: discs on both');
  assert.equal(pairHasHeadgear(null, 'ATL', 'GB'), false);
});

test('THE LIST IS THE DIRECTORY: every entry has both files, every file has an entry', () => {
  // Walk and count - a guard that names its files cannot see the one it forgot.
  const leagues = readdirSync(PUBLIC).sort();
  assert.deepEqual(leagues, Object.keys(HEADGEAR).sort(), 'one directory per league, no more');
  let files = 0;
  for (const lg of leagues) {
    const names = readdirSync(new URL(`${lg}/`, PUBLIC));
    files += names.length;
    for (const n of names) assert.match(n, /^[A-Z]{2,4}@[12]x\.webp$/, `${lg}/${n}`);
    const onDisk = new Set(names.map((n) => n.split('@')[0]));
    const listed = [...HEADGEAR[lg]].map((a) => headgearFile(lg, a));
    assert.deepEqual([...onDisk].sort(), [...listed].sort(), `${lg}: list and directory agree`);
    for (const f of listed) {
      assert.ok(names.includes(`${f}@1x.webp`) && names.includes(`${f}@2x.webp`), `${lg}/${f} has both densities`);
    }
  }
  assert.equal(HEADGEAR.nfl.size, 32); assert.equal(HEADGEAR.mlb.size, 30); assert.equal(HEADGEAR.cfb.size, 138);
  assert.equal(files, 400, '124 nfl/mlb + 276 cfb');
});

test('the files are WebP, as delivered', () => {
  for (const lg of Object.keys(HEADGEAR)) {
    for (const n of readdirSync(new URL(`${lg}/`, PUBLIC))) {
      const b = readFileSync(new URL(`${lg}/${n}`, PUBLIC));
      assert.equal(b.subarray(0, 4).toString('latin1'), 'RIFF', n); assert.equal(b.subarray(8, 12).toString('latin1'), 'WEBP', n);
    }
  }
});

test('CFB: found by the printed FBS abbreviation, the two odd file names resolve, FCS is null', () => {
  assert.deepEqual(headgearFor('cfb', 'UGA'), { src1x: '/headgear/cfb/UGA@1x.webp', src2x: '/headgear/cfb/UGA@2x.webp' });
  assert.equal(headgearFor('cfb', 'TA&M').src2x, '/headgear/cfb/TAM@2x.webp', 'Texas A&M: & does not go in a path');
  assert.equal(headgearFor('cfb', 'M-OH').src1x, '/headgear/cfb/MOH@1x.webp', 'Miami (OH)');
  assert.equal(headgearFor('cfb', 'TAM'), null, 'the file name is not a key');
  // FCS teams have no stored abbreviation; the letters a card derives for one
  // (Alabama A&M -> "Ala") are not a key, and the stored-only lookup in the
  // callers never offers them.
  assert.equal(headgearFor('cfb', 'Ala'), null);
  assert.equal(headgearFor('cfb', 'RICH'), null, 'Richmond, FCS');
  assert.equal(headgearFor('cfb', null), null);
});

test('THE NFL/CFB COLLISIONS resolve per league: MIA and HOU are two teams each', () => {
  for (const a of ['MIA', 'HOU']) {
    assert.equal(headgearFor('nfl', a).src1x, `/headgear/nfl/${a}@1x.webp`);
    assert.equal(headgearFor('cfb', a).src1x, `/headgear/cfb/${a}@1x.webp`);
    const bytes = (lg) => readFileSync(new URL(`${lg}/${a}@2x.webp`, PUBLIC));
    assert.equal(bytes('nfl').equals(bytes('cfb')), false, `${a}: the Dolphins/Texans file is not the Hurricanes/Cougars file`);
  }
});

test('TOR still resolves for mlb, and it is the re-rendered cap, not LAD', () => {
  assert.equal(headgearFor('mlb', 'TOR').src1x, '/headgear/mlb/TOR@1x.webp');
  const b = (a) => readFileSync(new URL(`mlb/${a}@2x.webp`, PUBLIC));
  assert.equal(b('TOR').equals(b('LAD')), false);
  assert.equal(b('TOR').length, 5716, 'the navy-brim cap from headgear-cfb @ 09a7ebc');
});
