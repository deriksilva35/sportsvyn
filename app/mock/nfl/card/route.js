/**
 * /mock/nfl/card?d=<payload> - "My NFL mock draft" share card (mon-3), 1080x1920.
 *
 * The NBA card's layout (app/mock/nba/card/route.js). The payload
 * (lib/mockNfl/share.js) carries the grade, the seat, the player ids, the roster
 * shape and the number of teams; names come from the season's stored pool. No session needed: it
 * is a picture of a draft the reader chose to share. A malformed payload 404s.
 */
import { readFileSync } from 'node:fs';
import { ImageResponse } from 'next/og';
import { decodeShare } from '@/lib/mockNfl/share';
import { readNflMockPool } from '@/lib/mockNfl/pool';
import { rosterFromIds, slotsFromCounts, SLOT_LABEL } from '@/lib/mockNfl/roster';
import { OG_ARCADE } from '@/lib/brand/ogPalette';

export const dynamic = 'force-dynamic';

// The arcade OG palette (lib/brand/ogPalette.js): a navy card, white text, a volt grade.
const INK = OG_ARCADE.primary; const PAPER = OG_ARCADE.page; const VOLT = OG_ARCADE.volt; const MUT = OG_ARCADE.line;

export async function GET(req) {
  const share = decodeShare(new URL(req.url).searchParams.get('d'));
  if (!share) return new Response('Not found', { status: 404 });
  const pool = await readNflMockPool().catch(() => null);
  const slots = slotsFromCounts(share.counts);
  const roster = rosterFromIds(share.ids, pool?.rows ?? [], slots);
  // readFileSync, NOT fetch(new URL(..., import.meta.url)): the Node runtime has no
  // file:// fetch ('not implemented... yet') - the Daily card's fix (app/daily/[date]/card).
  const saira = readFileSync(new URL('./Saira-BlackItalic.woff', import.meta.url));
  // A custom roster can run to 36 spots: the list shrinks to fit the card.
  const filled = roster.filter((r) => r.player);
  const fs = filled.length <= 13 ? 36 : filled.length <= 20 ? 28 : 18;
  const S = { display: 'flex', fontFamily: 'Saira', fontStyle: 'italic', color: PAPER };
  return new ImageResponse(
    (
      <div style={{ ...S, flexDirection: 'column', width: '1080px', height: '1920px', background: INK, padding: '90px 80px', justifyContent: 'space-between' }}>
        <div style={{ ...S, fontSize: 54, letterSpacing: '-2px' }}>SPORTSV<span style={{ display: 'flex', color: VOLT }}>Y</span>N</div>
        <div style={{ ...S, flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ ...S, fontSize: 44, color: MUT, letterSpacing: '6px' }}>MY NFL MOCK DRAFT</div>
          <div style={{ ...S, fontSize: 480, color: VOLT, lineHeight: 1, marginTop: -10 }}>{share.grade}</div>
          <div style={{ ...S, fontSize: 40, color: MUT, letterSpacing: '2px' }}>{`PICK ${share.seat} · ${share.teams} TEAMS · ${slots.length} ROUNDS`}</div>
        </div>
        <div style={{ ...S, flexDirection: 'column', gap: 4 }}>
          {filled.map((r, i) => (
            <div key={i} style={{ ...S, fontSize: fs, justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', color: VOLT, fontSize: 26, width: 110 }}>{SLOT_LABEL[r.slot]}</span>
              <span style={{ display: 'flex', flex: 1 }}>{r.player.name}</span>
              <span style={{ display: 'flex', color: MUT, fontSize: 28 }}>{r.player.team ?? ''}</span>
            </div>
          ))}
        </div>
        <div style={{ ...S, fontSize: 30, color: MUT }}>sportsvyn.com/mock/nfl</div>
      </div>
    ),
    { width: 1080, height: 1920, fonts: [{ name: 'Saira', data: saira, style: 'italic', weight: 900 }] },
  );
}
