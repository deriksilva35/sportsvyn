import { sql } from '../lib/db.js';

// 1. Prove the app's db layer can see the new tables
const tables = await sql`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`;
console.log(`Tables visible via lib/db.js: ${tables.length}`);
tables.forEach((t) => console.log(' -', t.table_name));

// 2. Prove real reads against the new sports tables succeed (expect 0 rows each)
const teams = await sql`SELECT count(*)::int AS n FROM teams`;
const players = await sql`SELECT count(*)::int AS n FROM players`;
const matches = await sql`SELECT count(*)::int AS n FROM matches`;
console.log(`Row counts — teams=${teams[0].n} players=${players[0].n} matches=${matches[0].n}`);
