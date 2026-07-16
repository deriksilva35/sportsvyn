// app/sim/draft/[id]/card/route.js — 1080x1920 share card (next/og ImageResponse).
// Ownership-scoped (getResults returns null for a draft that isn't the caller's).
// Saira Black Italic 900 is loaded as ACTUAL font data (committed .woff, read via
// import.meta.url) — the ONLY font supplied, so a successful render is Saira, not
// a fallback (Satori throws if a glyph has no matching font). Google Fonts CDN
// inside og render is not reliable; hence the committed asset.

import { ImageResponse } from 'next/og';
import { auth } from '@/auth';
import { getResults } from '@/lib/fantasy/drafts';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/ffc';

export const dynamic = 'force-dynamic';

const INK = '#0A0A0A'; const PAPER = '#F5F5F2'; const VOLT = '#D4FF00'; const MUT = '#8A8A86';
const STARTER_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, FLEX: 4, K: 5, DST: 6 };
const nameOf = (pk) => (pk.synthetic ? `Replacement ${pk.slotPos}` : pk.playerName);

export async function GET(_req, { params }) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return new Response('Unauthorized', { status: 401 });

  const r = await getResults(Number(id), userId);
  if (!r || r.draft?.status !== 'completed') return new Response('Not found', { status: 404 });

  const saira = await fetch(new URL('./Saira-BlackItalic.woff', import.meta.url)).then((res) => res.arrayBuffer());
  const starters = r.userPicks
    .filter((p) => p.rosterSlot !== 'BN')
    .sort((a, b) => (STARTER_ORDER[a.rosterSlot] ?? 9) - (STARTER_ORDER[b.rosterSlot] ?? 9));
  const bv = r.bestValue;
  const callout = bv ? `Best value: ${nameOf(bv)}, ${Math.round(bv.overallPick - bv.adpAtPick)} picks past ADP` : `${r.config.name}`;

  const S = { display: 'flex', fontFamily: 'Saira', fontStyle: 'italic', color: PAPER };
  return new ImageResponse(
    (
      <div style={{ ...S, flexDirection: 'column', width: '1080px', height: '1920px', background: INK, padding: '90px 80px', justifyContent: 'space-between' }}>
        <div style={{ ...S, fontSize: 54, letterSpacing: '-2px' }}>SPORTSV<span style={{ display: 'flex', color: VOLT }}>Y</span>N</div>

        <div style={{ ...S, flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ ...S, fontSize: 40, color: MUT, letterSpacing: '6px' }}>DRAFT GRADE</div>
          <div style={{ ...S, fontSize: 520, color: VOLT, lineHeight: 1, marginTop: -20 }}>{r.grade}</div>
          <div style={{ ...S, fontSize: 56, borderBottom: `8px solid ${VOLT}`, paddingBottom: 8 }}>{r.gradeScore}</div>
          <div style={{ ...S, fontSize: 30, color: MUT, marginTop: 40, letterSpacing: '2px' }}>{r.config.name.toUpperCase()}</div>
        </div>

        <div style={{ ...S, flexDirection: 'column', gap: 6 }}>
          {starters.map((p) => (
            <div key={p.overallPick} style={{ ...S, fontSize: 38, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', color: VOLT, fontSize: 26, width: 90 }}>{p.rosterSlot}</span>
              <span style={{ display: 'flex', flex: 1 }}>{nameOf(p)}</span>
              <span style={{ display: 'flex', color: MUT, fontSize: 28 }}>{p.team ?? ''}</span>
            </div>
          ))}
        </div>

        <div style={{ ...S, flexDirection: 'column', gap: 14 }}>
          <div style={{ ...S, fontSize: 34, color: VOLT }}>{callout}</div>
          <div style={{ ...S, fontSize: 22, color: MUT }}>{FFC_ATTRIBUTION.text}</div>
          <div style={{ ...S, fontSize: 30 }}>sportsvyn.com</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1920, fonts: [{ name: 'Saira', data: saira, weight: 900, style: 'italic' }] },
  );
}
