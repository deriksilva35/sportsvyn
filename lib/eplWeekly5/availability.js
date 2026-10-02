// lib/eplWeekly5/availability.js - the feed's injured / suspended list, stored.
//
// API-Sports /injuries?ids=<fixture ids> (up to 20 in ONE request) lists every
// player the provider expects to miss a fixture ('Missing Fixture') or doubts
// ('Questionable'), with a reason. Nothing stored it before EPL Weekly 5; the
// pool flags a row from epl_player_availability (migration 121).
//
// REPLACED WHOLE PER FIXTURE: a player back from injury drops off the
// provider's list, so a fetch that answered for a fixture deletes that
// fixture's rows and writes what it said. A fixture the response did not
// mention is cleared too - the provider answering for the ids with nothing is
// "nobody out", and that only happens on a SUCCESSFUL response.
//
// COST: one request per run, only while a gameweek has fixtures ahead.

const HOST = 'https://v3.football.api-sports.io';

export async function fetchInjuries(fixtureIds) {
  const res = await fetch(`${HOST}/injuries?ids=${fixtureIds.map(Number).join('-')}`, {
    headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
  });
  if (!res.ok) throw new Error(`API-Sports ${res.status} on /injuries`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) throw new Error(`API-Sports /injuries: ${JSON.stringify(json.errors)}`);
  return json.response ?? [];
}

/** PURE. The response -> rows per provider fixture id. */
export function rowsByFixture(response = []) {
  const by = new Map();
  for (const r of response) {
    const fx = r?.fixture?.id;
    const pid = r?.player?.id;
    if (fx == null || pid == null) continue;
    if (!by.has(String(fx))) by.set(String(fx), new Map());
    by.get(String(fx)).set(String(pid), {
      player_api_id: Number(pid), player_name: r.player.name ?? null,
      kind: r.player.type ?? null, reason: r.player.reason ?? null,
    });
  }
  return by;
}

/**
 * Refresh the flags for the fixtures of every unsettled gameweek that are
 * still ahead. Injectable fetch for tests.
 */
export async function refreshAvailability(sql, { now = new Date(), fetch: get = fetchInjuries } = {}) {
  const fixtures = await sql`
    SELECT DISTINCT m.id, m.external_ids->>'api_sports' AS fx
      FROM contests c
      CROSS JOIN LATERAL jsonb_array_elements(c.board) g
      JOIN matches m ON m.id = (g->>'match_id')::int
     WHERE c.game_type = 'epl_weekly_5' AND NOT c.settled AND c.puzzle_date IS NULL
       AND m.status = 'scheduled' AND m.kickoff_at > ${new Date(now).toISOString()}
       AND m.external_ids->>'api_sports' IS NOT NULL
     ORDER BY m.id LIMIT 20`;
  if (!fixtures.length) return { fixtures: 0, requests: 0 };
  const response = await get(fixtures.map((f) => f.fx));
  const by = rowsByFixture(response);
  let rows = 0;
  for (const f of fixtures) {
    const list = [...(by.get(String(f.fx))?.values() ?? [])];
    await sql`DELETE FROM epl_player_availability WHERE match_id = ${f.id}`;
    if (list.length) {
      await sql`
        INSERT INTO epl_player_availability (match_id, player_api_id, player_name, kind, reason, fetched_at)
        SELECT ${f.id}, x.player_api_id, x.player_name, x.kind, x.reason, now()
          FROM jsonb_to_recordset(${JSON.stringify(list)}::jsonb)
               AS x(player_api_id int, player_name text, kind text, reason text)
        ON CONFLICT (match_id, player_api_id) DO UPDATE
          SET kind = EXCLUDED.kind, reason = EXCLUDED.reason, player_name = EXCLUDED.player_name, fetched_at = now()`;
      rows += list.length;
    }
  }
  return { fixtures: fixtures.length, requests: 1, rows };
}
