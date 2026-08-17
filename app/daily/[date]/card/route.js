// app/daily/[date]/card/route.js — 1080x1920 reveal share card (next/og).
//
// PUBLIC ONCE REVEALED — the deliberate inversion of the sim's draft card,
// which is ownership-scoped and 401s a stranger. A reveal card exists to be
// shared with people who have not played, so gating it would defeat it. Before
// the day closes it 404s: the card carries the answer.
//
// Saira Black Italic is loaded as ACTUAL font data (committed .woff, read via
// import.meta.url). Google Fonts inside an og render is unreliable, and Satori
// THROWS on a glyph with no matching font - so a card that renders is Saira,
// not a silent fallback.

import { readFileSync } from 'node:fs';
import { ImageResponse } from 'next/og';
import { revealView } from '@/lib/daily/close';
import { sql } from '@/lib/db';
import { displayName } from '@/lib/daily/handles';

export const dynamic = 'force-dynamic';

const INK = '#0A0A0A'; const PAPER = '#F5F5F2'; const VOLT = '#D4FF00'; const MUT = '#8A8A86';
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);

export async function GET(_req, { params }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Not found', { status: 404 });
  const v = await revealView(date);
  if (v.state !== 'revealed') return new Response('Not found', { status: 404 });

  // THE CARD IS PUBLIC AND UNSCOPED - it exists to be shared with people who
  // have not played - so it names the DAY'S WINNER, never the viewer. There is
  // no session here to scope to, and inventing one would make the card
  // per-reader and uncacheable for no gain.
  const winner = await sql`
    SELECT u.id, u.handle, e.score
      FROM puzzle_entries e
      JOIN puzzle_days d ON d.puzzle_date = e.puzzle_date AND d.revealed
      JOIN users u ON u.id = e.user_id
     WHERE e.puzzle_date = ${date} AND e.locked_at IS NOT NULL AND e.score IS NOT NULL
     ORDER BY e.score DESC, u.id ASC LIMIT 1`
    .then((r) => r[0] ?? null).catch(() => null);
  const winnerName = winner ? displayName({ id: winner.id, handle: winner.handle }) : null;

  // READ, DO NOT FETCH. new URL(..., import.meta.url) is the right way to point
  // at the traced asset - it lands at .next/server/assets/Saira-*.woff in a
  // production build - but this route runs in the NODE runtime, and Node's
  // fetch has no file: scheme. It fails with "not implemented... yet...", which
  // surfaces as a bare 500 on the card and nowhere else. readFileSync takes the
  // same file: URL directly and keeps the asset tracing intact.
  const saira = readFileSync(new URL('./Saira-BlackItalic.woff', import.meta.url));
  const S = { display: 'flex', fontFamily: 'Saira', fontStyle: 'italic', color: PAPER };

  return new ImageResponse(
    (
      <div style={{ ...S, width: 1080, height: 1920, background: INK, flexDirection: 'column', padding: 88 }}>
        <div style={{ ...S, fontSize: 34, letterSpacing: 6, color: MUT }}>SPORTSVYN · THE DAILY</div>
        <div style={{ ...S, fontSize: 132, lineHeight: 1, marginTop: 40, color: VOLT }}>{v.season}</div>
        <div style={{ ...S, fontSize: 76, lineHeight: 1.1, marginTop: 6 }}>WEEK {v.week}</div>

        <div style={{ ...S, flexDirection: 'column', marginTop: 92, gap: 22 }}>
          <div style={{ ...S, fontSize: 34, letterSpacing: 5, color: MUT }}>PERFECT LINEUP</div>
          {(v.perfect?.picks ?? []).map((p) => (
            <div key={p.slot} style={{ ...S, alignItems: 'baseline', gap: 22, opacity: p.dropped ? 0.4 : 1 }}>
              <div style={{ ...S, width: 150, fontSize: 32, color: MUT }}>{p.slot.replace('FLEX2', 'FLEX')}</div>
              <div style={{ ...S, flex: 1, fontSize: 44 }}>{p.name}</div>
              <div style={{ ...S, fontSize: 44, color: VOLT }}>{fmt(p.points)}</div>
            </div>
          ))}
        </div>

        {/* OWN ROWS, NOT A SHARED BASELINE. These were a flex row with
            alignItems:'baseline', which reads fine until you do the arithmetic:
            904px of usable width against a 150px-italic total and a 38px label
            that together want more than that. The label wrapped and ran back
            across the number on every three-digit score - which is every score.
            Stacked, the width of one can never affect the other. */}
        <div style={{ ...S, marginTop: 'auto', flexDirection: 'column' }}>
          <div style={{ ...S, fontSize: 150, lineHeight: 1, color: VOLT }}>{fmt(v.perfect?.total)}</div>
          <div style={{ ...S, fontSize: 38, color: MUT, marginTop: 14 }}>PERFECT · PPR, DROP WORST</div>
        </div>
        <div style={{ ...S, fontSize: 28, color: MUT, marginTop: 30 }}>sportsvyn.com/daily</div>
      </div>
    ),
    { width: 1080, height: 1920, fonts: [{ name: 'Saira', data: saira, style: 'italic', weight: 900 }] },
  );
}
