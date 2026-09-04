// lib/footballdb/parse.test.mjs — the name-keyed header rule (ruling): an
// unknown extra column and a reordered column must parse identically to the
// baseline; a NEEDED column that goes missing must hard-error naming the tab
// and the column.

import test from 'node:test';
import assert from 'node:assert/strict';
import { toSeasonRows } from './parse.js';

// A minimal one-row Rushing tab, baseline column order - the 1980-1999 shape.
const baselineWorkbook = {
  Rushing: {
    headers: ['Player', 'Team', 'Gms', 'Att', 'Yds', 'TD', 'Lg'],
    rows: [['Derek Loville', 'SF', '16', '218', '693', '6', '22']],
  },
};

test('an unknown extra column and a reordered column parse identically to the baseline', () => {
  const withDrift = {
    Rushing: {
      // Reordered (Yds before Att) AND a trailing unknown column (2000/2001's
      // real "FD" addition) - neither is ever asked for by name, so neither
      // should change a single parsed field.
      headers: ['Player', 'Team', 'Gms', 'Yds', 'Att', 'TD', 'Lg', 'FD'],
      rows: [['Derek Loville', 'SF', '16', '693', '218', '6', '22', '30']],
    },
  };
  const baseline = toSeasonRows(baselineWorkbook);
  const drifted = toSeasonRows(withDrift);
  assert.deepEqual(drifted, baseline);
});

test('a NEEDED column missing from a read tab is a hard error naming the tab and the column', () => {
  const missingYds = {
    Rushing: {
      headers: ['Player', 'Team', 'Gms', 'Att', 'TD', 'Lg'], // Yds dropped
      rows: [['Derek Loville', 'SF', '16', '218', '6', '22']],
    },
  };
  assert.throws(
    () => toSeasonRows(missingYds),
    /footballdb parse: tab "Rushing" is missing required column "Yds"/,
  );
});

test('a tab this ingest never reads at all (Punting) is never checked, even with no headers', () => {
  const withPunting = {
    ...baselineWorkbook,
    Punting: { headers: ['Player', 'Team', 'Punts', 'Yds'], rows: [] }, // no RetTD - fine, never read
  };
  assert.doesNotThrow(() => toSeasonRows(withPunting));
});
