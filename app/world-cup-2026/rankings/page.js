/**
 * /world-cup-2026/rankings: rankings hub for the namespaced competition.
 *
 * Lists the ranking surfaces this competition declares in
 * leagues.metadata.rankings (e.g. ['power', 'players']) and links to
 * each leaf route. The order of cards mirrors the order of the slugs
 * in metadata, so editorial ordering is configurable from the data
 * layer without touching this file.
 *
 * Unknown URL leaves (slugs in metadata that have no entry in
 * lib/competition.js#RANKING_LIST_META_BY_URL_LEAF) are skipped
 * silently. This way the migration can land before every leaf is
 * implemented.
 *
 * No DB reads here. The hub renders only from the resolved metadata.
 */

import { notFound } from 'next/navigation';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import {
  resolveCompetitionBySegment,
  getRankingListMetaForUrlLeaf,
} from '@/lib/competition';

const COMPETITION_URL_SLUG = 'world-cup-2026';

export const metadata = {
  title: 'Rankings · Sportsvyn',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const wrapStyle    = { maxWidth: 960, margin: '0 auto', padding: '48px 24px 80px' };
const kickerStyle  = {
  fontFamily: 'var(--font-saira), system-ui, sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  fontSize: 12,
  color: 'var(--volt)',
  marginBottom: 12,
};
const titleStyle   = {
  fontFamily: 'var(--font-serif), Georgia, serif',
  fontSize: 56,
  lineHeight: 1.05,
  margin: '0 0 16px',
};
const dekStyle     = {
  fontFamily: 'var(--font-serif), Georgia, serif',
  fontSize: 19,
  lineHeight: 1.5,
  color: 'var(--text-mute, #555)',
  margin: '0 0 40px',
  maxWidth: 720,
};
const gridStyle    = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 16,
};
const leafStyle    = {
  display: 'block',
  padding: '20px 22px',
  border: '1px solid var(--border, rgba(0,0,0,0.12))',
  borderRadius: 6,
  textDecoration: 'none',
  color: 'var(--ink, #0A0A0A)',
  background: 'var(--paper, #fafaf7)',
};
const leafTitle    = {
  fontFamily: 'var(--font-saira), system-ui, sans-serif',
  fontSize: 22,
  fontWeight: 800,
  fontStyle: 'italic',
  letterSpacing: '-0.01em',
  color: 'var(--ink, #0A0A0A)',
  margin: '0 0 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};
const leafTagline  = {
  fontFamily: 'var(--font-serif), Georgia, serif',
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--text-mute, #555)',
  margin: 0,
};
const arrowStyle   = { color: 'var(--volt)', fontWeight: 700 };

export default async function RankingsHubPage() {
  const comp = await resolveCompetitionBySegment(COMPETITION_URL_SLUG);
  if (!comp) notFound();

  const declaredLeaves = Array.isArray(comp.surfaces.rankings) ? comp.surfaces.rankings : [];
  if (declaredLeaves.length === 0) notFound();

  const leaves = declaredLeaves
    .map((leaf) => {
      const meta = getRankingListMetaForUrlLeaf(leaf);
      if (!meta) return null;
      return { urlLeaf: leaf, ...meta };
    })
    .filter(Boolean);

  if (leaves.length === 0) notFound();

  return (
    <>
      <SiteHeaderServer activeNav="rankings" />
      <main style={wrapStyle}>
        <div style={kickerStyle}>Rankings {'·'} {comp.name}</div>
        <h1 style={titleStyle}>
          Rankings, side by side.
        </h1>
        <p style={dekStyle}>
          Sportsvyn keeps separate rankings for teams and for the players inside them. Pick a list.
        </p>

        <div style={gridStyle}>
          {leaves.map((leaf) => (
            <a
              key={leaf.urlLeaf}
              href={`/world-cup-2026/rankings/${leaf.urlLeaf}`}
              style={leafStyle}
            >
              <div style={leafTitle}>
                <span>{leaf.label}</span>
                <span style={arrowStyle} aria-hidden="true">{'->'}</span>
              </div>
              <p style={leafTagline}>{leaf.tagline}</p>
            </a>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
