// lib/ops/runLock.test.mjs - one run at a time (tue-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireLock } from './runLock.js';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'runlock-')), 'x.lock');

test('the second acquire while the first holds it is refused, naming the holder', () => {
  const p = tmp();
  const a = acquireLock(p);
  assert.equal(a.ok, true);
  assert.equal(readFileSync(p, 'utf8'), String(process.pid));
  const b = acquireLock(p);
  assert.deepEqual(b, { ok: false, holder: process.pid });
  a.release();
  assert.equal(existsSync(p), false, 'released');
  const c = acquireLock(p); assert.equal(c.ok, true); c.release();
});

test('a lock whose owner is gone is stale and taken over', () => {
  const p = tmp();
  writeFileSync(p, '2147483646');            // no such pid
  const a = acquireLock(p);
  assert.equal(a.ok, true);
  assert.equal(readFileSync(p, 'utf8'), String(process.pid));
  a.release();
});

test('release never removes a lock somebody else now holds', () => {
  const p = tmp();
  const a = acquireLock(p);
  writeFileSync(p, String(process.ppid));     // someone else took it over
  a.release();
  assert.equal(readFileSync(p, 'utf8'), String(process.ppid));
});
