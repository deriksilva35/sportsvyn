import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSeasonYear } from './seasonResolver.js';

test('July preseason -> current calendar year', () => {
  assert.equal(resolveSeasonYear(new Date('2026-07-15T12:00:00Z')), 2026);
});
test('Aug 29 (CFB Week 0) -> current year', () => {
  assert.equal(resolveSeasonYear(new Date('2026-08-29T18:00:00Z')), 2026);
});
test('December regular season -> current year', () => {
  assert.equal(resolveSeasonYear(new Date('2026-12-15T20:00:00Z')), 2026);
});
test('January playoffs -> prior year season', () => {
  assert.equal(resolveSeasonYear(new Date('2027-01-10T20:00:00Z')), 2026);
});
test('June offseason -> prior year season', () => {
  assert.equal(resolveSeasonYear(new Date('2026-06-30T20:00:00Z')), 2025);
});
test('July 1 boundary (month >= 7) -> current year', () => {
  assert.equal(resolveSeasonYear(new Date('2026-07-01T00:00:00Z')), 2026);
});
