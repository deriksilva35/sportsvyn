// lib/nba/detail.js - the NBA line score, timeouts and bonus into
// matches.metadata.detail. ONE WRITER, NESTED MERGE.
//
// THE HOUSE RULE (CLAUDE.md, "jsonb || is SHALLOW"): metadata.detail already
// holds final_seen_at, written by lib/live/write.js. `metadata || {detail:...}`
// would replace the whole detail object and delete it - the 14 Aug defect. So
// the merge is written out one level down:
//
//   metadata || jsonb_build_object('detail',
//     COALESCE(metadata->'detail','{}') || <incoming>)
//
// and nothing is written when every incoming key already holds the same value.

export async function writeNbaDetail(sql, matchId, detail) {
  if (!detail || typeof detail !== 'object' || !Object.keys(detail).length) return false;
  const inc = JSON.stringify(detail);
  const r = await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('detail',
                           CASE WHEN jsonb_typeof(metadata->'detail') = 'object'
                                THEN metadata->'detail' ELSE '{}'::jsonb END
                           || ${inc}::jsonb),
           updated_at = now()
     WHERE id = ${matchId}
       AND EXISTS (SELECT 1 FROM jsonb_each(${inc}::jsonb) d
                    WHERE (COALESCE(matches.metadata->'detail', '{}'::jsonb) -> d.key) IS DISTINCT FROM d.value)
    RETURNING id`;
  return r.length > 0;
}
