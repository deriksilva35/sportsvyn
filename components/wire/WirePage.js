// components/wire/WirePage.js — /{league}/wire.
//
// STICKY DAY HEADERS because a wire is scrolled rather than read, and a reader
// forty items down needs to know which day they are in without going back up.
//
// A CHIP IS ABSENT WHEN THE LEAGUE HAS NO SOURCE FOR IT. There is no NCAAF
// injury feed and no college club-site RSS pattern, so /cfb/wire offers neither
// chip rather than offering an empty one - the same absent-not-disabled rule
// the nav pills keep.

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import LeagueHeader from '@/components/league/LeagueHeader';
import WireItem from './WireItem';
import { leagueWire, chipsForLeague, dayKey } from '@/lib/wire/read';
import { parseWireChip, parseWirePage, wireHref } from '@/lib/wire/wireNav';
import '@/components/gridiron/gridiron.css';
import '@/components/league/league.css';
import './wire.css';

const PER_PAGE = 30;

export default async function WirePage({ leagueSlug, label, sp }) {
  const chip = parseWireChip(sp);
  const page = parseWirePage(sp);
  const now = new Date();
  const { items, hasMore } = await leagueWire(leagueSlug, {
    limit: PER_PAGE, offset: page * PER_PAGE, chip,
  }).catch(() => ({ items: [], hasMore: false }));

  // Grouped in render order; the reader never sees a day header with nothing
  // under it because the groups are built from the items themselves.
  const groups = [];
  for (const it of items) {
    const k = dayKey(it.published_at ?? it.seen_at);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, items: [] });
    groups[groups.length - 1].items.push(it);
  }

  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav={leagueSlug} />
      <LeagueHeader label={label} leagueSlug={leagueSlug} pathname={`/${leagueSlug}/wire`} />

      <div className="wpage">
        <nav className="wchips" aria-label="Wire lanes">
          <Link className={`wchip${chip ? '' : ' on'}`} href={wireHref(leagueSlug)}>All</Link>
          {chipsForLeague(leagueSlug).map((c) => (
            <Link
              key={c.key}
              className={`wchip${chip === c.key ? ' on' : ''}`}
              href={wireHref(leagueSlug, { chip: c.key })}
            >
              {c.label}
            </Link>
          ))}
        </nav>

        {groups.length === 0 ? (
          <div className="wempty">Nothing on the wire yet.</div>
        ) : groups.map((g) => (
          <section key={g.key}>
            <div className="wday">{g.key}</div>
            {g.items.map((i) => <WireItem key={i.id} item={i} now={now} />)}
          </section>
        ))}

        {hasMore ? (
          <Link className="wmore" href={wireHref(leagueSlug, { chip, page: page + 1 })}>Earlier →</Link>
        ) : null}
      </div>

      <SiteFooter />
    </div>
  );
}
