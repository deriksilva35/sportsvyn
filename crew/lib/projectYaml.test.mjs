// crew/lib/projectYaml.test.mjs - fri-4: crew/project.yaml is read by CrewOS, so it must parse as
// strict YAML. An unquoted ": " inside a value (approvals, "MONTH ONE: Approve") broke the parse;
// an unquoted comma inside a flow mapping (rung.fixer) parsed but split into a bogus null key.
// js-yaml is already in node_modules (via eslint); no new dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'project.yaml');

function load() {
  return yaml.load(readFileSync(FILE, 'utf8'), { filename: FILE });
}

// Every leaf, with its dotted path, so a failure names the key.
function leaves(v, at = '') {
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => leaves(x, at ? `${at}.${k}` : k));
  }
  return [[at, v]];
}

test('crew/project.yaml parses as strict YAML (no error, duplicate keys refused)', () => {
  assert.doesNotThrow(load);
  const doc = load();
  assert.equal(typeof doc, 'object');
  assert.equal(doc.project, 'sportsvyn');
});

test('no key parses to null (an unquoted comma or colon split a value)', () => {
  const nulls = leaves(load()).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  assert.deepEqual(nulls, []);
});

test('values that hold ": " or "," keep their full text', () => {
  const doc = load();
  assert.equal(doc.where_things_go.approvals,
    "Derik's decision. MONTH ONE: Approve = Derik runs apply_command by hand; no auto-replay");
  assert.deepEqual(doc.rung, { fixer: '2 (PR only, Derik merges)', watcher: 'read-only', data_keeper: 'dry-run only' });
});
