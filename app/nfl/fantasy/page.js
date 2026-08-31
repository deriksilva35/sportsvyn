// app/nfl/fantasy — the ADP Movement Board.
//
// SERVER COMPONENT. It does both reads (movement + Sportsvyn ADP), merges them
// in JS on ffc_player_id, and hands finished rows to the client island. The
// merge happens HERE rather than in SQL because the two aggregates must not be
// joined through sim_player_pool: that table holds one row per player per
// snapshot per format, so any join through it multiplies the pick counts.
//
// PUBLIC AND INDEXABLE. This is editorial surface, not a member tool - there is
// deliberately NO `robots` export here, so the page inherits the site default
// and is indexed. The /sim routes noindex themselves; this one must not.
//
// force-dynamic because the board reflects the morning's snapshot and the
// running draft corpus; a statically cached copy would go stale by a day.

import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SportsvynSegment from '@/components/shell/SportsvynSegment';
import LeagueHeader from '@/components/league/LeagueHeader';
import '@/components/league/league.css';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import SiteFooter from '@/components/SiteFooter';
import MovementBoard from '@/components/fantasy/MovementBoard';
import {
  getMovementBoard, getSportsvynAdp, getRookieIds, divergence, sizeForFormat,
  MIN_D3_HISTORY, MIN_DRIFT_HISTORY, SV_MIN_DRAFTS,
} from '@/lib/fantasy/movement';
import {
  PAGE, METHOD, PROV_LABELS, PROV_SOURCE, EMPTY, bandLegend, thinNotice,
} from '@/components/fantasy/boardCopy';
import '@/components/gridiron/gridiron.css';
import '@/components/fantasy/fantasy.css';

export const dynamic = 'force-dynamic';

// v0.3: this board is also half of the app's SPORTSVYN tab. Shell mode gets
// the safe-area viewport and the segment; the web page is unchanged, public
// and indexable (the metadata below deliberately has no robots override).
export async function generateViewport({ searchParams }) {
  return simViewport(await resolveShellMode((await searchParams) ?? {}));
}

export const metadata = {
  title: 'The Movement Board - NFL Fantasy ADP - Sportsvyn',
  description:
    'Where drafters are actually taking players, and how that has changed. Average draft position across every scoring format, updated every morning.',
};

const FALLBACK_FORMAT = 'ppr';

export default async function FantasyMovementBoard({ searchParams }) {
  const params = (await searchParams) ?? {};
  const isShell = await resolveShellMode(params);
  // UNFORCED, v0.6. This is a LEAGUE ROUTE - it wears the league header and
  // sits behind the Fantasy pill - and the ruling is that every league route
  // opens signed-out in the shell. The Movement Board is a board of numbers,
  // not an entry surface; nothing on it is the reader's own.
  //
  // The import stays because removing it would take the audit list in
  // lib/shell/signedOut.test.mjs with it, and this page keeping the machinery
  // while declining to use it is the honest record of a decision.
  const session = await auth();
  const raw = Array.isArray(params.format) ? params.format[0] : params.format;
  const format = sizeForFormat(raw) ? raw : FALLBACK_FORMAT;

  // Rookie flags come from the shared helper, keyed by the matched nfl_players
  // id the pool already carries - the entry card reads the same one.
  const [board, sv, rookieIds] = await Promise.all([
    getMovementBoard(format), getSportsvynAdp(), getRookieIds(),
  ]);

  const players = board.players.map((p) => {
    const s = sv.get(p.ffcPlayerId) ?? null;
    return {
      ...p,
      isRookie: p.matchedPlayerId != null && rookieIds.has(p.matchedPlayerId),
      // Gated: below SV_MIN_DRAFTS the value exists but is never shown.
      svAdp: s?.eligible ? s.svAdp : null,
      svAppearances: s?.appearances ?? 0,
      div: divergence(s, p.adp),
    };
  });

  const size = board.size;
  const eligible = players.filter((p) => p.bandEligible);
  const steam = eligible.filter((p) => p.band.key === 'steam').length;
  const sliding = eligible.filter((p) => p.band.key === 'sliding').length;
  const notice = thinNotice(board.snapshotCount);
  const dayOne = board.snapshotCount < 2;

  const prov = [
    [PROV_LABELS.snapshot, board.latestSnapshot ?? EMPTY.head],
    [PROV_LABELS.pool, `${format} · ${size}-team · ${players.length} players`],
    [PROV_LABELS.history, `${board.snapshotCount} ${board.snapshotCount === 1 ? 'snapshot' : 'snapshots'}`],
    [PROV_LABELS.source, PROV_SOURCE],
    [PROV_LABELS.sv, `${SV_MIN_DRAFTS} drafts to qualify`],
  ];

  return (
    <div data-surface="ink">
      <GlobalHeaderServer activeNav="fantasy" />
      {isShell && <SportsvynSegment />}
      {/* ONE HEADER, EVERY LEAGUE PAGE. This is an NFL surface, so it carries
          the league's own destinations with Fantasy filled - /scores, /market
          and /stats stay network surfaces and get none. */}
      <LeagueHeader label="NFL" leagueSlug="nfl" pathname="/nfl/fantasy" />
      <div className="fb-wrap">
        <div className="fb-head">
          <div>
            <div className="fb-kicker">
              {PAGE.kicker}
              {/* Web cross-nav to the scoreboard; the shell's segment owns
                  this hop, so it is web-only - same rule as /scores. */}
              {!isShell && <a className="gi-cross" href="/scores">Scoreboard &rarr;</a>}
            </div>
            <h1 className="fb-title">{PAGE.title[0]}<br />{PAGE.title[1]}</h1>
            <p className="fb-sub">{PAGE.sub}</p>
          </div>
          <div className="fb-strip">
            <div className="fb-stat"><div className="k">Players</div><div className="v">{players.length}</div></div>
            <div className="fb-stat"><div className="k">Steam</div><div className="v volt">{steam}</div></div>
            <div className="fb-stat"><div className="k">Sliding</div><div className="v terra">{sliding}</div></div>
            <div className="fb-stat"><div className="k">Snapshots</div><div className="v">{board.snapshotCount}</div></div>
          </div>
        </div>

        <div className="fb-prov">
          {prov.map(([k, v]) => <div key={k}>{k} <b>{v}</b></div>)}
        </div>

        <div className="fb-panel">
          <div className="fb-panel-head">
            <div className="lbl">{PAGE.panelLabel}<span className="mono">{players.length} players</span></div>
            <div className="fb-panel-note">{PAGE.panelNote}</div>
          </div>

          {notice ? (
            <div className="fb-notice"><span className="mk" /><span className="tx">{notice}</span></div>
          ) : null}

          {dayOne ? (
            <div className="fb-empty">
              <div className="h">{EMPTY.head}</div>
              <div className="p">{EMPTY.body}</div>
            </div>
          ) : (
            <MovementBoard board={{ ...board, players }} format={format} />
          )}
        </div>

        <div className="fb-method">
          <div>
            <h4>{METHOD.title}</h4>
            <p>{METHOD.body}</p>
          </div>
          <div>
            <h4>{METHOD.bandsTitle}</h4>
            <div className="fb-bands">
              {bandLegend(size).map((b) => (
                <div key={b.key} className="fb-bl"><span className={`fb-band ${b.key}`}>{b.label}</span> {b.text}</div>
              ))}
            </div>
            <p style={{ marginTop: '11px' }}>{METHOD.bandNote}</p>
          </div>
          <div>
            <h4>{METHOD.svTitle}</h4>
            <p>{METHOD.svBody}</p>
          </div>
          <div>
            <h4>{METHOD.gatesTitle}</h4>
            <p>{METHOD.gatesBody}</p>
          </div>
        </div>

        <div className="fb-attr">{PAGE.attr}</div>
      </div>
      <SiteFooter />
    </div>
  );
}
