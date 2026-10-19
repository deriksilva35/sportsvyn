/**
 * /og/email/chip/<match slug>.png - the morning email's scoreboard chip (mon-3):
 * PT time first, then ET, the league, each team's mark, italic name and
 * abbreviation. Public data only, publicly cached, drawn at 2x (1120x360).
 */
import { ImageResponse } from 'next/og';
import { chipCard, CHIP } from '@/lib/email/cards';
import { chipData } from '@/lib/email/imageData';
import { keyOf, PUBLIC_CACHE, cardFonts, absolutize } from '@/lib/email/imageRoute';

export async function GET(request, { params }) {
  const { file } = await params;
  const slug = keyOf(file);
  const g = slug ? await chipData(slug).catch(() => null) : null;
  if (!g) return new Response('not found', { status: 404 });
  const card = chipCard({ ...g, away: absolutize(g.away, request.url), home: absolutize(g.home, request.url) });
  return new ImageResponse(card, { ...CHIP, fonts: await cardFonts(), headers: PUBLIC_CACHE });
}
