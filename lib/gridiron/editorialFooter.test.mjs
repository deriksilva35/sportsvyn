// lib/gridiron/editorialFooter.test.mjs - an editorial board's footer is prose,
// never the publisher's JSON (27 Sep: the NFL Power footer read
// {"forWeek":{"season":2026,"week":2},"k":20,...} under the table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../testing/nextResolve.mjs';

install();
const { footerFromNotes } = await import('./readers.js');

test('a computed edition\'s JSON notes are not a footer; a hand-seeded sentence is', () => {
  const blob = '{"forWeek":{"season":2026,"week":2},"k":20,"hfa":55,"regress":0.3333333333333333,"games":6}';
  assert.equal(footerFromNotes(blob), null, 'the shipped string');
  assert.equal(footerFromNotes({ forWeek: { season: 2026, week: 2 } }), null, 'jsonb handed back as an object');
  assert.equal(footerFromNotes('[1,2]'), null);
  assert.equal(footerFromNotes('Named and left off: **Chargers**, **Seahawks**.'), 'Named and left off: **Chargers**, **Seahawks**.');
  assert.equal(footerFromNotes('{not json} but a sentence'), '{not json} but a sentence', 'prose that starts with a brace stays');
  assert.equal(footerFromNotes('  '), null); assert.equal(footerFromNotes(null), null);
});

test('getEditorialBoard hands the footer through footerFromNotes', () => {
  const src = readFileSync(new URL('./readers.js', import.meta.url), 'utf8');
  assert.match(src, /footer: footerFromNotes\(rows\[0\]\.footer\),/);
});
