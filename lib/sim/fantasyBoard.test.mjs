// Fantasy Board aggregations. Loads .env.local (module imports db); adpMovers is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p){let t;try{t=readFileSync(p,"utf8");}catch{return;}for(const line of t.split("\n")){const s=line.trim();if(!s||s.startsWith("#"))continue;const eq=s.indexOf("=");if(eq<0)continue;const k=s.slice(0,eq).trim();let v=s.slice(eq+1).trim();if(v.startsWith(String.fromCharCode(34))&&v.endsWith(String.fromCharCode(34)))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}})(path.resolve(__dirname, '..', '..', '.env.local'));

const { adpMovers } = await import('./fantasyBoard.js');

test('adpMovers: rising/falling by |delta|, skips new + unchanged', () => {
  const current = [
    { ffc_player_id: '1', name: 'A', position: 'RB', adp: 10 }, // prior 15 -> +5 rising
    { ffc_player_id: '2', name: 'B', position: 'WR', adp: 20 }, // prior 18 -> -2 falling
    { ffc_player_id: '3', name: 'C', position: 'TE', adp: 30 }, // no prior -> skip
    { ffc_player_id: '4', name: 'D', position: 'QB', adp: 40 }, // prior 40 -> 0 skip
  ];
  const prior = [
    { ffc_player_id: '1', adp: 15 }, { ffc_player_id: '2', adp: 18 }, { ffc_player_id: '4', adp: 40 },
  ];
  const m = adpMovers(current, prior);
  assert.equal(m.length, 2);
  assert.equal(m[0].name, 'A'); assert.equal(m[0].delta, 5);  // biggest |delta| first
  assert.equal(m[1].name, 'B'); assert.equal(m[1].delta, -2);
});
