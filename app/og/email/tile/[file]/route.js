/**
 * /og/email/tile/<game>.png - an empty game tile for "Free to play" (mon-3):
 * Pick'em (empty picks + confidence ranks), the Daily (8 empty slots), the
 * Weekly (an empty roster), any other game by name. No data at all; publicly
 * cached, drawn at 2x (360x440).
 */
import { ImageResponse } from 'next/og';
import { tileCard, TILE } from '@/lib/email/cards';
import { TILE_KINDS } from '@/lib/email/imageData';
import { keyOf, PUBLIC_CACHE, cardFonts } from '@/lib/email/imageRoute';

export async function GET(request, { params }) {
  const { file } = await params;
  const t = TILE_KINDS[keyOf(file)];
  if (!t) return new Response('not found', { status: 404 });
  return new ImageResponse(tileCard(t), { ...TILE, fonts: await cardFonts(), headers: PUBLIC_CACHE });
}
