/**
 * /mock/nba/card?d=<payload> - "My NBA mock draft" share card (sun-5), 1080x1920.
 *
 * The payload (lib/mockNba/share.js) carries the grade, the seat and the 13
 * player ids; names come from the season's stored pool. No session needed: it
 * is a picture of a draft the reader chose to share. A malformed payload 404s.
 */
import { ImageResponse } from 'next/og';
import { decodeShare } from '@/lib/mockNba/share';
import { readNbaMockPool } from '@/lib/mockNba/pool';
import { rosterFromIds } from '@/lib/mockNba/roster';
import { OG_ARCADE } from '@/lib/brand/ogPalette';

export const dynamic = 'force-dynamic';

// The arcade OG palette (lib/brand/ogPalette.js): a navy card, white text, a volt grade.
const INK = OG_ARCADE.primary; const PAPER = OG_ARCADE.page; const VOLT = OG_ARCADE.volt; const MUT = OG_ARCADE.line;

export async function GET(req) {
  const share = decodeShare(new URL(req.url).searchParams.get('d'));
  if (!share) return new Response('Not found', { status: 404 });
  const pool = await readNbaMockPool().catch(() => null);
  const roster = rosterFromIds(share.ids, pool?.rows ?? []);
  const saira = await fetch(new URL('./Saira-BlackItalic.woff', import.meta.url)).then((res) => res.arrayBuffer());
  const S = { display: 'flex', fontFamily: 'Saira', fontStyle: 'italic', color: PAPER };
  return new ImageResponse(
    (
      <div style={{ ...S, flexDirection: 'column', width: '1080px', height: '1920px', background: INK, padding: '90px 80px', justifyContent: 'space-between' }}>
        <div style={{ ...S, fontSize: 54, letterSpacing: '-2px' }}>SPORTSV<span style={{ display: 'flex', color: VOLT }}>Y</span>N</div>
        <div style={{ ...S, flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ ...S, fontSize: 44, color: MUT, letterSpacing: '6px' }}>MY NBA MOCK DRAFT</div>
          <div style={{ ...S, fontSize: 480, color: VOLT, lineHeight: 1, marginTop: -10 }}>{share.grade}</div>
          <div style={{ ...S, fontSize: 40, color: MUT, letterSpacing: '2px' }}>{`PICK ${share.seat} · 12 TEAMS · 13 ROUNDS`}</div>
        </div>
        <div style={{ ...S, flexDirection: 'column', gap: 4 }}>
          {roster.filter((r) => r.player).map((r, i) => (
            <div key={i} style={{ ...S, fontSize: 36, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', color: VOLT, fontSize: 26, width: 110 }}>{r.slot}</span>
              <span style={{ display: 'flex', flex: 1 }}>{r.player.name}</span>
              <span style={{ display: 'flex', color: MUT, fontSize: 28 }}>{r.player.team ?? ''}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S, fontSize: 30, color: MUT }}>sportsvyn.com/mock/nba</div>
      </div>
    ),
    { width: 1080, height: 1920, fonts: [{ name: 'Saira', data: saira, style: 'italic', weight: 900 }] },
  );
}
