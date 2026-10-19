/**
 * /og/email/hero/<YYYY-MM-DD>.png - the season-opener hero (mon-3): the eyebrow,
 * NBA IS BACK, tonight's chips stacked. 404 on a day with no opener. Public data
 * only, publicly cached, drawn at 2x.
 */
import { ImageResponse } from 'next/og';
import { heroCard, heroSize } from '@/lib/email/cards';
import { heroData } from '@/lib/email/imageData';
import { keyOf, PUBLIC_CACHE, cardFonts, absolutize } from '@/lib/email/imageRoute';

export async function GET(request, { params }) {
  const { file } = await params;
  const day = keyOf(file);
  const hero = day ? await heroData(day).catch(() => null) : null;
  if (!hero) return new Response('not found', { status: 404 });
  const games = hero.games.map((g) => ({ ...g, away: absolutize(g.away, request.url), home: absolutize(g.home, request.url) }));
  return new ImageResponse(heroCard({ ...hero, games }), { ...heroSize(games.length), fonts: await cardFonts(), headers: PUBLIC_CACHE });
}
