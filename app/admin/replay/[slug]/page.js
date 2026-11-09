/**
 * /admin/replay/[slug]?play=<provider_play_id> | ?at=<ISO> - THE DRIVE CARD, REPLAYED.
 *
 * A finished NFL/CFB game's live card exactly as it looked right after one play:
 * score, clock, down & distance, ball, first-down line, drive band and totals,
 * red zone and the scoring flash. It mounts the SAME CardFace the board and the
 * game page mount, fed by lib/gridiron/replay.js, which truncates the stored
 * plays and calls the same driveCardFor / driveStripFor the live path calls.
 *
 * Auth: proxy.js gates every /admin/* path with the admin Basic Auth (step 1,
 * lib/admin/adminAuth.js). There is no Server Action here and nothing is
 * written: three SELECTs (the game, its plays, its drive envelopes) and a render.
 */

import { FALLBACK_TZ } from '@/lib/time/display';
import '@/components/gridiron/gridiron.css';
import '@/app/scores/scoresV4.css';
import '@/components/gridiron/gamePageArcade.css';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGamePage } from '@/lib/gridiron/gameDetail';
import { gamecastFor } from '@/lib/gridiron/playsImport';
import { CardFace } from '@/components/scores/ScoreboardV4';
import { cardVariant } from '@/lib/gridiron/scoresV2Shape';
import { replayFor, replayOrder } from '@/lib/gridiron/replay';
import { whenLabel } from '@/lib/gridiron/gamePageArcade';
import { downLabel } from '@/lib/gridiron/driveCard';
import { cfbPlayText } from '@/lib/gridiron/playText';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Drive card replay', robots: { index: false, follow: false } };

const one = (v) => (Array.isArray(v) ? v[0] : v);
const href = (slug, play) => `/admin/replay/${encodeURIComponent(slug)}?play=${encodeURIComponent(play)}`;

export default async function ReplayPage({ params, searchParams }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const game = await getGamePage(slug);
  if (!game) notFound();
  const gamecast = await gamecastFor(game.id);
  const plays = gamecast?.plays ?? [];
  if (!plays.length) notFound();

  const play = one(sp.play) ?? null;
  const at = one(sp.at) ?? null;
  const r = replayFor({ game, plays, drives: gamecast.drives ?? [], play, at });
  if (!r) notFound();

  const cfb = game.leagueSlug === 'cfb';
  const txt = (t) => (cfb ? cfbPlayText(t) : t) ?? '';
  const ordered = replayOrder(plays);
  const cur = r.cut.index;
  const prev = cur > 0 ? ordered[cur - 1] : null;
  const next = cur < ordered.length - 1 ? ordered[cur + 1] : null;
  const variant = cardVariant(r.g);

  return (
    <div className="gi" data-surface="ink" data-replay="1" style={{ maxWidth: 430, margin: '0 auto', padding: '12px 16px 48px' }}>
      <p style={{ font: '600 12px/1.4 var(--tok-font-display, sans-serif)', margin: '0 0 8px' }}>
        REPLAY (admin) · {game.slug} · play {cur + 1} of {ordered.length} · clock {r.now.toISOString()}
      </p>
      <article className={`sv4-card ${variant} gpa-card`} data-variant={variant} data-league={game.leagueSlug} data-slug={game.slug} data-gpa="card">
        <CardFace g={r.g} x={r.x} signedIn={false} signinHref="/signin" tz={FALLBACK_TZ} now={r.now} onPage />
      </article>
      <nav data-replay="nav" style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0', font: '500 13px var(--tok-font-display, sans-serif)' }}>
        {prev ? <Link data-replay="prev" href={href(game.slug, prev.providerPlayId)}>&lsaquo; prev</Link> : <span />}
        {next ? <Link data-replay="next" href={href(game.slug, next.providerPlayId)}>next &rsaquo;</Link> : <span />}
      </nav>
      <ol data-replay="plays" style={{ listStyle: 'none', margin: 0, padding: 0, font: '400 12px/1.35 var(--tok-font-display, sans-serif)' }}>
        {ordered.map((p, i) => (
          <li key={`${p.providerPlayId}-${i}`} data-replay-play={p.providerPlayId} aria-current={i === cur ? 'true' : undefined}
            style={{ padding: '4px 0', borderTop: '1px solid var(--tok-line)', fontWeight: i === cur ? 700 : 400 }}>
            <Link href={href(game.slug, p.providerPlayId)}>{p.providerPlayId}</Link>
            {' · '}{whenLabel(p.period, p.clock)}
            {' · '}{downLabel(p.down, p.distance, p.yardsToGoal) ?? '-'}
            {p.scoring ? ' · SCORING' : ''}
            {' · '}{txt(p.text)}
          </li>
        ))}
      </ol>
    </div>
  );
}
