// lib/email/renderLocal.js - draw the morning email's pictures OUTSIDE Next
// (mon-3): the test script renders the same element trees the /og/email/*
// routes serve, with the marks read from public/ as data URIs, and sends them
// inline (cid:). Node only; never imported by the app.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chipCard, heroCard, tileCard, CHIP, TILE, heroSize } from './cards.js';
import { chipData, heroData, TILE_KINDS } from './imageData.js';
import { shareCardFonts } from '../daily/shareCardFonts.js';

const ROOT = process.cwd();
const og = () => import(join(ROOT, 'node_modules/next/dist/compiled/@vercel/og/index.node.js'));
const inlineMark = async (t) => ({ ...t, src: t.path ? `data:image/png;base64,${(await readFile(join(ROOT, 'public', t.path))).toString('base64')}` : null });
async function png(el, size) {
  const { ImageResponse } = await og();
  const { fonts } = await shareCardFonts(ROOT);
  return Buffer.from(await new ImageResponse(el, { ...size, fonts }).arrayBuffer());
}

/** route path ("/og/email/chip/x.png") -> PNG Buffer, or null when the route would 404. */
export async function renderLocal(path) {
  const m = /^\/og\/email\/(chip|hero|tile)\/([a-z0-9-]+)\.png$/.exec(path);
  if (!m) return null;
  const [, kind, key] = m;
  if (kind === 'chip') {
    const g = await chipData(key);
    return g ? png(chipCard({ ...g, away: await inlineMark(g.away), home: await inlineMark(g.home) }), CHIP) : null;
  }
  if (kind === 'hero') {
    const hero = await heroData(key);
    if (!hero) return null;
    const games = await Promise.all(hero.games.map(async (g) => ({ ...g, away: await inlineMark(g.away), home: await inlineMark(g.home) })));
    return png(heroCard({ ...hero, games }), heroSize(games.length));
  }
  const t = TILE_KINDS[key];
  return t ? png(tileCard(t), TILE) : null;
}
