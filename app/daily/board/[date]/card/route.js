// app/daily/board/[date]/card/route.js - the Daily share card, 1080x1680 (9:14).
//
// THE READER'S OWN CARD for one edition (relay mon-12, Derik's mock: Play tab
// canvas, "Daily share card", the two roster cards). Signed out is a 401; no
// submitted run on that edition is a 404. What the card may SAY - and above
// all what the same-day card may NOT say - is decided in lib/daily/shareCard.js;
// this file only draws the model it is handed, so a name the model does not
// carry cannot appear here.
//
// FONTS ARE READ, NOT FETCHED (lib/daily/shareCardFonts.js): Rubik Mono One
// and static Rubik 400/600 TTFs from assets/fonts - with Rubik Bold standing
// in for any weight whose file has not landed yet. THE WORDMARK IS THE BRAND SVG
// (public/brand/sportsvyn-header-wordmark-dark.svg: white letters, the volt
// circumflex), embedded as a data URI - the mark itself, not a re-typesetting
// of it. The lock, flame and star are drawn as SVG paths: an emoji in Satori
// is fetched from a CDN at render time, and a card must not depend on that.
//
// PRIVATE, NEVER CACHED: the card carries one reader's score.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { shareCardFor } from '@/lib/daily/shareCardData';
import { CARD_WIDTH, CARD_HEIGHT } from '@/lib/daily/shareCard';
import { DAILY_CARD as C } from '@/lib/brand/dailyCardPalette';
import { shareCardFonts } from '@/lib/daily/shareCardFonts';

export const dynamic = 'force-dynamic';

const MONO = 'RubikMono';
const flex = { display: 'flex' };

function Flame({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill={C.flame} d="M12 1.5c.6 3.2-1 5.3-2.6 7.1C7.8 10.4 6 12.3 6 15.2 6 19 8.7 22 12 22s6-3 6-6.8c0-2.6-1.3-4.6-2.6-6.1-.3 1.6-1.1 2.8-2.3 3.3.4-3.6-.6-7.6-1.1-10.9z" />
      <path fill={C.flameCore} d="M12 22c-1.9 0-3.4-1.6-3.4-3.7 0-1.9 1.3-3 2.4-4.4.3 1.2 1 2 2 2.3-.2-1.2.2-2.5.9-3.4 1 1.3 1.5 2.7 1.5 4.3 0 2.7-1.5 4.9-3.4 4.9z" />
    </svg>
  );
}

function Lock({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="none" stroke={C.soft} strokeWidth="2.4" strokeLinecap="round" d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7" />
      <rect x="4.5" y="10.5" width="15" height="11" rx="2.5" fill={C.soft} />
    </svg>
  );
}

function Star({ size = 40, color = C.volt }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill={color} d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8L2.2 9.3l6.9-.8z" />
    </svg>
  );
}

function Chip({ slot, ink }) {
  return (
    <div style={{ ...flex, width: 138, flexShrink: 0, justifyContent: 'center', borderRadius: 21, padding: '12px 0', background: C.chip, color: ink, fontFamily: MONO, fontSize: 30 }}>
      {slot}
    </div>
  );
}

function Header({ m }) {
  return (
    <div style={{ ...flex, justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ ...flex, fontFamily: MONO, fontSize: 33, letterSpacing: 3.3, color: C.volt }}>{m.header}</div>
      {m.streak ? (
        <div style={{ ...flex, alignItems: 'center', gap: 8, background: C.pill, borderRadius: 99, padding: '12px 30px', fontFamily: MONO, fontSize: 30 }}>
          <Flame size={32} /><div style={flex}>{m.streak}</div>
        </div>
      ) : null}
    </div>
  );
}

function ScoreBlock({ m }) {
  return (
    <div style={{ ...flex, flexDirection: 'column' }}>
      <div style={{ ...flex, fontFamily: MONO, fontSize: m.scoreSize, lineHeight: 1 }}>{m.scoreLabel}</div>
      <div style={{ ...flex, fontFamily: MONO, fontSize: 33, letterSpacing: 3.3, color: C.soft, marginTop: 12 }}>POINTS</div>
    </div>
  );
}

function Footer({ m, right }) {
  return (
    <div style={{ ...flex, marginTop: 'auto', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image */}
      <img src={m.wordmark} width={360} height={72} alt="SPORTSVYN" />
      {right}
    </div>
  );
}

// A COLUMN, NOT A FRAGMENT: Satori lays a fragment's children into the
// parent as one row, so each card is its own full-height column.
function OpenCard({ m }) {
  return (
    <div style={{ ...flex, flexDirection: 'column', flex: 1, width: '100%' }}>
      <Header m={m} />
      <div style={{ ...flex, marginTop: 48 }}><ScoreBlock m={m} /></div>
      {m.rankLine ? <div style={{ ...flex, fontSize: 36, color: C.soft, marginTop: 18 }}>{m.rankLine}</div> : null}
      <div style={{ ...flex, fontFamily: MONO, fontSize: 42, color: C.volt, marginTop: 30 }}>{m.challenge}</div>
      <div style={{ ...flex, flexDirection: 'column', marginTop: 36 }}>
        {m.slots.map((s, i) => (
          <div key={i} style={{ ...flex, alignItems: 'center', gap: 30, padding: '21px 0', borderTop: `3px solid ${C.rule}` }}>
            <Chip slot={s.slot} ink={s.ink} />
            <div style={{ ...flex, flex: 1, height: 36, borderRadius: 18, background: C.bar }} />
            <Lock size={39} />
          </div>
        ))}
      </div>
      <div style={{ ...flex, fontSize: 36, color: C.soft, marginTop: 24 }}>{m.footnote}</div>
      <Footer m={m} right={<div style={{ ...flex, fontSize: 36, color: C.soft }}>{m.footRight}</div>} />
    </div>
  );
}

function ClosedCard({ m }) {
  return (
    <div style={{ ...flex, flexDirection: 'column', flex: 1, width: '100%' }}>
      <Header m={m} />
      <div style={{ ...flex, alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 48 }}>
        <ScoreBlock m={m} />
        <div style={{ ...flex, flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {m.pctLabel ? <div style={{ ...flex, fontFamily: MONO, fontSize: 48, color: C.volt }}>{m.pctLabel}</div> : null}
          <div style={{ ...flex, alignItems: 'center', fontSize: 36, color: C.soft }}>
            {m.pctLabel ? 'of perfect · ' : ''}{`${m.starCount} of ${m.slotCount}`}
            <div style={{ ...flex, marginLeft: 8 }}><Star size={34} /></div>
          </div>
        </div>
      </div>
      {m.rankLine ? <div style={{ ...flex, fontSize: 36, color: C.soft, marginTop: 18 }}>{m.rankLine}</div> : null}
      <div style={{ ...flex, flexDirection: 'column', marginTop: 42 }}>
        {m.rows.map((r, i) => (
          <div key={i} style={{ ...flex, alignItems: 'center', gap: 30, padding: '21px 0', borderTop: `3px solid ${C.rule}` }}>
            <Chip slot={r.slot} ink={r.ink} />
            <div style={{ ...flex, flex: 1, alignItems: 'baseline', gap: 14, overflow: 'hidden' }}>
              <div style={{ ...flex, fontSize: 45, fontWeight: 600 }}>{r.name ?? 'Empty slot'}</div>
              {r.team ? <div style={{ ...flex, fontSize: 36, color: C.soft }}>{r.team}</div> : null}
            </div>
            <div style={{ ...flex, fontFamily: MONO, fontSize: 39 }}>{r.points ?? '0.0'}</div>
            <div style={{ ...flex, width: 54, justifyContent: 'flex-end' }}>
              {r.star ? <Star size={42} /> : <div style={{ ...flex, fontSize: 39, color: C.dim }}>·</div>}
            </div>
          </div>
        ))}
      </div>
      <Footer m={m} right={(
        <div style={{ ...flex, alignItems: 'center', fontSize: 36, color: C.soft }}>
          <Star size={34} /><div style={{ ...flex, marginLeft: 10 }}>{m.legend}</div>
        </div>
      )} />
    </div>
  );
}

export async function GET(_req, { params }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Not found', { status: 404 });
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return new Response('Unauthorized', { status: 401 });

  const model = await shareCardFor(sql, { date, userId: Number(userId) });
  if (!model) return new Response('Not found', { status: 404 });

  const [{ fonts }, mark] = await Promise.all([
    shareCardFonts(),
    readFile(join(process.cwd(), 'public/brand/sportsvyn-header-wordmark-dark.svg')),
  ]);
  const m = { ...model, wordmark: `data:image/svg+xml;base64,${mark.toString('base64')}` };

  return new ImageResponse(
    (
      <div style={{ ...flex, flexDirection: 'column', width: CARD_WIDTH, height: CARD_HEIGHT, boxSizing: 'border-box', padding: 72, background: C.ground, color: C.ink, fontFamily: 'Rubik', fontWeight: 400 }}>
        {m.phase === 'open' ? <OpenCard m={m} /> : <ClosedCard m={m} />}
      </div>
    ),
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
