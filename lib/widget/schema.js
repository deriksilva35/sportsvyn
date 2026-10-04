// lib/widget/schema.js - THE FEED'S SCHEMA, AS DATA, AND A SMALL VALIDATOR
// (sun-22). No dependency: a dozen type builders and one walk.
//
// STRICT BOTH WAYS. A key the schema names must be present (null where the
// type allows it), and a key the schema does not name is an error - so a field
// added to lib/widget/shape.js without being added here (and to
// docs/widgets/feed-v1.md) fails the fixture test instead of shipping unseen.
//
// The Mac can read this file as the field list; docs/widgets/feed-v1.md is the
// same list with prose and examples.

import { GAMES_MAX, TEAMS_MAX, IN_YOUR_GAMES_MAX, FEED_VERSION } from './shape.js';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const nullable = (t) => ({ ...t, nullable: true });
export const T = {
  str: (max = 64) => ({ kind: 'str', max }),
  int: () => ({ kind: 'int' }),
  num: () => ({ kind: 'num' }),
  bool: () => ({ kind: 'bool' }),
  iso: () => ({ kind: 'iso' }),
  lit: (value) => ({ kind: 'lit', value }),
  oneOf: (...values) => ({ kind: 'enum', values }),
  obj: (fields) => ({ kind: 'obj', fields }),
  arr: (item, max) => ({ kind: 'arr', item, max }),
  n: nullable,
};

const STATE = T.oneOf('ok', 'signed_out', 'age_required');
const CTA = T.n(T.obj({ label: T.str(24), href: T.str(64) }));
const STATUS = T.oneOf('pre', 'live', 'final', 'none');
const SPORT = T.str(12);

export const GAME = T.obj({
  key: T.str(32), sport: SPORT, name: T.str(40), title: T.n(T.str(40)), line: T.n(T.str(40)),
  count: T.n(T.int()), lockAt: T.n(T.iso()), urgent: T.bool(), href: T.n(T.str(64)),
});

export const TEAM = T.obj({
  teamId: T.int(), team: T.str(6), teamName: T.n(T.str(24)), league: T.n(T.str(8)),
  color: T.n(T.str(9)), altColor: T.n(T.str(9)),
  gameId: T.n(T.int()), home: T.n(T.bool()), oppId: T.n(T.int()), opp: T.n(T.str(6)), oppName: T.n(T.str(24)),
  status: STATUS, score: T.n(T.int()), oppScore: T.n(T.int()), clock: T.n(T.str(16)),
  winProb: T.n(T.int()), startAt: T.n(T.iso()), nextAt: T.n(T.iso()),
  result: T.n(T.oneOf('W', 'L', 'T')), href: T.n(T.str(64)),
});

export const STAKE = T.obj({
  gameId: T.int(), league: T.str(8), away: T.str(6), home: T.str(6),
  awayColor: T.n(T.str(9)), homeColor: T.n(T.str(9)),
  awayScore: T.n(T.int()), homeScore: T.n(T.int()), status: STATUS, clock: T.n(T.str(16)), startAt: T.n(T.iso()),
  pick: T.n(T.str(6)), pickState: T.n(T.oneOf('pending', 'winning', 'losing', 'tied', 'won', 'lost', 'push')),
  players: T.int(), points: T.n(T.num()), href: T.n(T.str(64)),
});

export const FEED = T.obj({
  v: T.lit(FEED_VERSION),
  state: STATE,
  generatedAt: T.iso(),
  cta: CTA,
  yourMove: T.obj({
    count: T.int(),
    nextLock: T.n(T.obj({ game: T.str(40), sport: T.n(SPORT), at: T.iso() })),
  }),
  games: T.arr(GAME, GAMES_MAX),
  daily: T.n(T.obj({
    state: T.oneOf('play', 'in-progress', 'done', 'none'), open: T.bool(), closesAt: T.n(T.iso()),
    streak: T.int(), href: T.str(64),
  })),
  teams: T.arr(TEAM, TEAMS_MAX),
  inYourGames: T.arr(STAKE, IN_YOUR_GAMES_MAX),
});

export const PICKER_TEAM = T.obj({
  id: T.int(), abbr: T.str(6), name: T.n(T.str(24)), league: T.str(8), color: T.n(T.str(9)), altColor: T.n(T.str(9)),
});

export const PICKER = T.obj({
  v: T.lit(FEED_VERSION), state: STATE, generatedAt: T.iso(), cta: CTA,
  followed: T.arr(PICKER_TEAM, 1000), teams: T.arr(PICKER_TEAM, 5000),
});

/** Every violation, as 'path: message'. Empty array = valid. */
export function validate(value, schema, path = '$') {
  const errs = [];
  const bad = (m) => errs.push(`${path}: ${m}`);
  if (value === null || value === undefined) {
    if (value === undefined) bad('missing');
    else if (!schema.nullable) bad('null not allowed');
    return errs;
  }
  switch (schema.kind) {
    case 'str':
      if (typeof value !== 'string') bad(`expected string, got ${typeof value}`);
      else if (value.length > schema.max) bad(`longer than ${schema.max}`);
      break;
    case 'int':
      if (!Number.isInteger(value)) bad(`expected integer, got ${JSON.stringify(value)}`);
      break;
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value)) bad(`expected number, got ${JSON.stringify(value)}`);
      break;
    case 'bool':
      if (typeof value !== 'boolean') bad(`expected boolean, got ${typeof value}`);
      break;
    case 'iso':
      if (typeof value !== 'string' || !ISO_Z.test(value)) bad(`expected UTC ISO ending in Z, got ${JSON.stringify(value)}`);
      break;
    case 'lit':
      if (value !== schema.value) bad(`expected ${JSON.stringify(schema.value)}`);
      break;
    case 'enum':
      if (!schema.values.includes(value)) bad(`expected one of ${schema.values.join('|')}, got ${JSON.stringify(value)}`);
      break;
    case 'arr':
      if (!Array.isArray(value)) { bad('expected array'); break; }
      if (value.length > schema.max) bad(`more than ${schema.max} items`);
      value.forEach((v, i) => errs.push(...validate(v, schema.item, `${path}[${i}]`)));
      break;
    case 'obj': {
      if (typeof value !== 'object' || Array.isArray(value)) { bad('expected object'); break; }
      for (const [k, s] of Object.entries(schema.fields)) errs.push(...validate(value[k], s, `${path}.${k}`));
      for (const k of Object.keys(value)) if (!(k in schema.fields)) errs.push(`${path}.${k}: not in the schema`);
      break;
    }
    default:
      bad(`unknown schema kind ${schema.kind}`);
  }
  return errs;
}
