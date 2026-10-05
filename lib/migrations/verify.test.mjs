// lib/migrations/verify.test.mjs - the backfill's parser and verdicts, on
// sample migration text and a hand-built catalog (no database).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMigration, verifyUnits, normName, parseComment } from './verify.mjs';
import { readMigrationsDir } from './ledger.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_DIR = path.join(__dirname, '..', '..', 'migrations');

const keys = (p) => p.events.map((e) => `${e.key}=${e.expect}`);

test('CREATE TABLE: table, columns, NOT NULL, named and unnamed keys; constraint lines are not columns', () => {
  const p = parseMigration(`
    -- a comment that says CREATE TABLE nope (x int);
    CREATE TABLE IF NOT EXISTS public.widgets (
      id         bigserial PRIMARY KEY,
      "Label"    text NOT NULL DEFAULT 'a, b; c',
      size       numeric(3,2),
      CONSTRAINT widgets_size_check CHECK (size > 0),
      UNIQUE (size)
    );`);
  assert.deepEqual(keys(p), [
    'table:widgets=present',
    'column:widgets.id=present', 'nullable:widgets.id=NOT NULL', 'constraint:widgets.widgets_pkey=present',
    'column:widgets.Label=present', 'nullable:widgets.Label=NOT NULL',
    'column:widgets.size=present',
    'constraint:widgets.widgets_size_check=present',
  ]);
  assert.ok(!keys(p).some((k) => k.includes('nope')), 'comments are not read');
});

test('ALTER TABLE with several actions, and an ADD CONSTRAINT inside a DO $$ guard', () => {
  const p = parseMigration(`
    ALTER TABLE player_leagues
      ADD COLUMN IF NOT EXISTS span text NOT NULL DEFAULT 'season',
      ADD COLUMN IF NOT EXISTS starts_at timestamptz,
      ALTER COLUMN code SET NOT NULL;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pl_shape') THEN
        ALTER TABLE player_leagues ADD CONSTRAINT pl_shape CHECK (span <> '');
      END IF;
    END $$;`);
  assert.deepEqual(keys(p), [
    'column:player_leagues.span=present', 'nullable:player_leagues.span=NOT NULL',
    'column:player_leagues.starts_at=present',
    'column:player_leagues.code=present', 'nullable:player_leagues.code=NOT NULL',
    'constraint:player_leagues.pl_shape=present',
  ]);
  assert.deepEqual(p.unrecognized, []);
});

test('a dollar-quoted VALUE is a string, not code (042 inserts a prompt that way)', () => {
  const p = parseMigration(`INSERT INTO prompts (body) VALUES ($$You write; CREATE TABLE nothing (x int); then stop.$$);`);
  assert.equal(p.events.length, 0);
  assert.equal(p.data.length, 1);
  assert.deepEqual(p.unrecognized, []);
});

test('indexes, functions, triggers, drops, renames', () => {
  const p = parseMigration(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_a ON t (a);
    CREATE OR REPLACE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.at = now(); RETURN NEW; END $$;
    CREATE TRIGGER t_touch BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION touch();
    DROP INDEX IF EXISTS idx_old;
    ALTER TABLE t DROP COLUMN IF EXISTS gone, DROP CONSTRAINT IF EXISTS t_c;
    ALTER TABLE t RENAME COLUMN a TO b;
    ALTER TABLE t ADD PRIMARY KEY (b);`);
  assert.deepEqual(keys(p), [
    'index:idx_a=present', 'function:touch=present', 'trigger:t.t_touch=present', 'index:idx_old=absent',
    'column:t.gone=absent', 'constraint:t.t_c=absent', 'column:t.a=absent', 'column:t.b=present',
    'constraint:t.t_pkey=present',
  ]);
});

test('COMMENT ON parses its literal (doubled quotes, adjacent literals) for a comment check', () => {
  const c = parseComment(`COMMENT ON COLUMN match_events.gloss IS 'NULL = not yet; '''' = empty' ' and more'`);
  assert.equal(c.key, 'comment:column:match_events.gloss');
  assert.equal(c.expect, "NULL = not yet; '' = empty and more");
  assert.equal(parseComment(`COMMENT ON TABLE x IS NULL`).expect, null);
  assert.equal(normName('"Mixed"'), 'Mixed');
  assert.equal(normName('Public.Foo'), 'foo');
});

function catalog({ tables = [], columns = {}, indexes = [], constraints = [], comments = {} } = {}) {
  return {
    tables: new Set(tables), relations: new Set(tables),
    columns: new Map(Object.entries(columns)),
    indexes: new Map(indexes.map((i) => [i, { table: null, valid: true }])),
    constraints: new Set(constraints), functions: new Set(), triggers: new Set(), types: new Set(),
    extensions: new Set(), schemas: new Set(['public']), comments: new Map(Object.entries(comments)),
  };
}

test('verdicts: verified, partial, missing, unverifiable; later drops supersede earlier creates', () => {
  const units = [
    { number: 1, name: '001', parsed: parseMigration(`CREATE TABLE a (id int NOT NULL, x int); CREATE INDEX a_x ON a (x);`) },
    { number: 2, name: '002', parsed: parseMigration(`ALTER TABLE a ADD COLUMN y int, ADD COLUMN z int;`) },
    { number: 3, name: '003', parsed: parseMigration(`ALTER TABLE a ADD COLUMN w int;`) },
    { number: 4, name: '004', parsed: parseMigration(`UPDATE a SET x = 1;`) },
    { number: 5, name: '005', parsed: parseMigration(`DROP INDEX a_x; COMMENT ON TABLE a IS 'the a';`) },
  ];
  const cat = catalog({
    tables: ['a'],
    columns: { 'a.id': 'NO', 'a.x': 'YES', 'a.y': 'YES' },
    comments: { 'table:a': 'the a' },
  });
  const r = Object.fromEntries(verifyUnits(units, cat).map((x) => [x.number, x]));
  assert.equal(r[1].verdict, 'verified', JSON.stringify(r[1]));
  assert.equal(r[1].superseded.length, 1, 'a_x was dropped by 005: not looked for');
  assert.equal(r[2].verdict, 'partial');
  assert.deepEqual(r[2].missing, ['column a.z absent, expected present']);
  assert.equal(r[3].verdict, 'missing');
  assert.equal(r[4].verdict, 'unverifiable');
  assert.equal(r[5].verdict, 'verified', 'the drop holds, and the comment matches');
});

test('comment drift is listed, not a verdict, unless comments are all there is', () => {
  const units = [
    { number: 1, name: '001', parsed: parseMigration(`CREATE TABLE a (id int); COMMENT ON TABLE a IS 'new words';`) },
    { number: 2, name: '002', parsed: parseMigration(`COMMENT ON COLUMN a.id IS 'the id';`) },
  ];
  const cat = catalog({ tables: ['a'], columns: { 'a.id': 'YES' }, comments: { 'table:a': 'old words' } });
  const [one, two] = verifyUnits(units, cat);
  assert.equal(one.verdict, 'verified');
  assert.deepEqual(one.drift, ['comment on table a differs from the file']);
  assert.equal(two.verdict, 'missing', 'a comment-only migration is judged by its comments');
});

test('every real migration parses with nothing unrecognized', () => {
  const d = readMigrationsDir(REAL_DIR);
  for (const u of d.units) {
    const p = parseMigration(u.files.map((f) => f.bytes.toString('utf8')).join('\n;\n'));
    assert.deepEqual(p.unrecognized, [], `${u.name}: ${p.unrecognized.join(' | ')}`);
  }
});
