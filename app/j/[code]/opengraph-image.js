// app/j/[code]/opengraph-image.js - THE INVITE CARD (Leagues V1 P4): what a
// /j/<key> link unfurls to in a group chat. 1200x630, arcade: the league's
// name, its games, how full it is, who runs it. A dead key still renders a
// card (the brand and "League invite"), never an error image.
//
// FONTS ARE READ, NOT FETCHED: Rubik Mono One and Rubik Bold (SIL OFL) are
// committed in assets/fonts and read from process.cwd() - the pattern the
// Next 16 opengraph-image docs give for the Node runtime. Not new URL(...,
// import.meta.url): webpack turns that into an asset URL readFile cannot open. Colours are lib/brand/ogPalette.js -
// Satori cannot read CSS tokens.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { invitePreview } from '@/lib/leagues/invite';
import { gameLabel, SPAN_LABEL, FORMAT_LABEL } from '@/lib/leagues/settings';
import { OG_ARCADE as C } from '@/lib/brand/ogPalette';

export const alt = 'A Sportsvyn league invite';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const chip = { display: 'flex', padding: '10px 22px', borderRadius: 999, background: C.surface2, color: C.primary, fontSize: 26, fontFamily: 'RubikMono', marginRight: 14, marginBottom: 14 };

export default async function Image({ params }) {
  const { code } = await params;
  const p = await invitePreview(code).catch(() => null);
  const lg = p?.league ?? null;
  const mono = await readFile(join(process.cwd(), 'assets/fonts/RubikMonoOne-Regular.ttf'));
  const bold = await readFile(join(process.cwd(), 'assets/fonts/Rubik-Bold.ttf'));
  const name = lg ? String(lg.name).toUpperCase() : 'LEAGUE INVITE';
  const chips = lg ? [...lg.games.map(gameLabel), SPAN_LABEL[lg.span], FORMAT_LABEL[lg.format]].filter(Boolean) : [];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.page, padding: '56px 64px', fontFamily: 'Rubik', color: C.ink }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontFamily: 'RubikMono', fontSize: 34, color: C.primary }}>SPORTSVYN</div>
          <div style={{ display: 'flex', fontFamily: 'RubikMono', fontSize: 22, padding: '10px 20px', borderRadius: 999, background: C.primary, color: C.volt }}>LEAGUE INVITE</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
          <div style={{ display: 'flex', fontSize: 30, color: C.muted, marginBottom: 14 }}>
            {lg?.owner_handle ? `@${lg.owner_handle} invited you to` : 'You are invited to'}
          </div>
          <div style={{ display: 'flex', fontFamily: 'RubikMono', fontSize: name.length > 18 ? 64 : 84, lineHeight: 1.05, color: C.primary }}>{name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 28 }}>
            {chips.map((c) => <div key={c} style={chip}>{c.toUpperCase()}</div>)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `3px solid ${C.line}`, paddingTop: 24 }}>
          <div style={{ display: 'flex', fontSize: 30, color: C.ink }}>
            {lg ? `${lg.members} of ${lg.max_members} members · free, always` : 'Play the games with your people. Free, always.'}
          </div>
          <div style={{ display: 'flex', fontFamily: 'RubikMono', fontSize: 26, padding: '14px 28px', borderRadius: 18, background: C.volt, color: C.primary }}>JOIN</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'RubikMono', data: mono, weight: 400, style: 'normal' },
        { name: 'Rubik', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
