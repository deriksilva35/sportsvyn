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

import { ImageResponse } from 'next/og';
import { revealView } from '@/lib/daily/close';

export const dynamic = 'force-dynamic';

const INK = '#0A0A0A'; const PAPER = '#F5F5F2'; const VOLT = '#D4FF00'; const MUT = '#8A8A86';
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);

export async function GET(_req, { params }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Not found', { status: 404 });
  const v = await revealView(date);
  if (v.state !== 'revealed') return new Response('Not found', { status: 404 });

  const saira = await fetch(new URL('./Saira-BlackItalic.woff', import.meta.url)).then((r) => r.arrayBuffer());
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

        <div style={{ ...S, marginTop: 'auto', alignItems: 'baseline', gap: 24 }}>
          <div style={{ ...S, fontSize: 150, lineHeight: 1, color: VOLT }}>{fmt(v.perfect?.total)}</div>
          <div style={{ ...S, fontSize: 38, color: MUT }}>PERFECT · PPR, DROP WORST</div>
        </div>
        <div style={{ ...S, fontSize: 28, color: MUT, marginTop: 26 }}>sportsvyn.com/daily</div>
      </div>
    ),
    { width: 1080, height: 1920, fonts: [{ name: 'Saira', data: saira, style: 'italic', weight: 900 }] },
  );
}
