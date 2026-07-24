// components/gridiron/TodayPage.js — shared server render for the /nfl and /cfb
// Today shells. Paper ground (data-surface="paper") with an ink instrument block
// (the week slate) sitting on it, per the Surface Rule. Local ink header + sport
// sub-nav; NO site header. DEV reads only.
import Wordmark from '@/components/gridiron/Wordmark';
import { getSeasonState, getCurrentWeek, getWeekSlate, getStandings } from '@/lib/gridiron/readers';
import { getH2hOdds } from '@/lib/gridiron/oddsReader';
import { normalizeTwoWayPct, isPreGame } from '@/lib/gridiron/oddsFormat';

function scoreline(g) {
  if (g.status === 'final') return { txt: `${g.awayScore}-${g.homeScore}`, cls: 'sc' };
  if (g.status === 'live') return { txt: 'LIVE', cls: '' };
  return { txt: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(g.kickoffAt)) + ' ET', cls: '' };
}

// Cheap inline favored-side read for the slate row (scheduled games only): the
// higher-probability team abbr + its de-vigged %, e.g. "KC 63%". A recessive tag,
// not the full strip (that lives on the /scores card).
function favoredTag(odds) {
  if (!odds?.home || !odds?.away) return null;
  const pct = normalizeTwoWayPct(odds.away.implied, odds.home.implied);
  if (!pct) return null;
  const homeFav = pct.b >= pct.a;
  const side = homeFav ? odds.home : odds.away;
  const p = homeFav ? pct.b : pct.a;
  return `${side.abbr} ${Math.round(p)}%`;
}
const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

export default async function TodayPage({ leagueSlug, leagueLabel, tabs, standingsPhase = 'REG', searchParams }) {
  const sp = (await searchParams) ?? {};
  const state = await getSeasonState(leagueSlug);
  const seasonYear = state?.seasonYear ?? 2025;
  const cur = await getCurrentWeek(leagueSlug, seasonYear);
  const phase = (sp.phase === 'POST' || sp.phase === 'REG') ? sp.phase : (cur?.seasonPhase ?? 'REG');
  const week = Number(sp.week) || cur?.week || 1;

  const [slate, standings] = await Promise.all([
    getWeekSlate(leagueSlug, seasonYear, phase, week),
    getStandings(leagueSlug, seasonYear, standingsPhase),
  ]);
  // One batch odds read for the whole week's slate (no per-row fan-out).
  const oddsMap = await getH2hOdds(slate.byDay.flatMap((d) => d.games.map((g) => g.id)));

  return (
    <div className="gi" data-surface="paper">
      <header className="gi-head">
        <Wordmark href={`/${leagueSlug}`} />
        <nav className="gi-head-nav">
          <a href="/nfl">TODAY</a>
          <a href="/scores">SCORES</a>
          <a className={leagueSlug === 'nfl' ? 'active' : ''} href="/nfl">NFL</a>
          <a className={leagueSlug === 'cfb' ? 'active' : ''} href="/cfb">CFB</a>
          <a href="#">SOCCER</a>
        </nav>
        <div className="gi-head-right"><a href="#">MY SPORTSVYN</a><span className="gi-member">MEMBER</span></div>
      </header>

      <nav className="gi-subnav">
        {tabs.map((t, i) => <a key={t} className={i === 0 ? 'active' : ''} href="#">{t}</a>)}
        <span className="gi-season">{state ? <>{state.seasonYear} SEASON · <b>{phase} WEEK {week}</b></> : `${leagueLabel} 2025`}</span>
      </nav>

      {/* paper lede zone (placeholder editorial, clearly marked) */}
      <section className="gi-lede">
        <div className="gi-lede-in">
          <div className="gi-ph-wrap"><span className="ph">Placeholder editorial</span></div>
          <div className="kick"><span className="sq" />{leagueLabel} · {state?.label ?? '2025 SEASON'}</div>
          <h1>The Week in {leagueLabel}</h1>
          <p>Lede copy ships from the editorial pipeline. This paper-ground zone is the reading surface; the slate below is the ink instrument. Real 2025 results render underneath.</p>
        </div>
      </section>

      <div className="gi-wrap">
        <div className="gi-today-grid">
          {/* left: ink instrument — the week slate grouped by day */}
          <section className="gi-instrument" data-surface="ink">
            <div className="gi-instrument-h">{leagueLabel} · {phase} Week {week}</div>
            <div className="gi-instrument-sub">{slate.total} games</div>
            {slate.byDay.length === 0 && <div className="gi-empty">No games for this week.</div>}
            {slate.byDay.map((d) => (
              <div className="gi-day" key={d.etDay}>
                <div className="gi-day-h">{DAY_FULL[d.weekday] ?? d.weekday}</div>
                {d.games.map((g) => {
                  const s = scoreline(g);
                  const fav = isPreGame(g.status) ? favoredTag(oddsMap.get(g.id)) : null;
                  return (
                    <div className="gi-row" key={g.id}>
                      <span className="mu">{g.away.abbreviation || g.away.name} <span className="vs">at</span> {g.home.abbreviation || g.home.name}{fav && <span className="fav"> · {fav}</span>}</span>
                      <span className="rt"><span className={s.cls}>{s.txt}</span></span>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>

          {/* right: paper standings rail */}
          <aside className="gi-standings">
            <div className="gi-rail-h">{standingsPhase} Standings</div>
            {standings.flatMap((conf) => conf.divisions.map((div) => {
              const heading = [conf.conference, div.division].filter(Boolean).join(' ');
              return (
                <div className="gi-div" key={heading}>
                  <div className="gi-div-h">{heading}</div>
                  {div.teams.map((t) => (
                    <div className="gi-strow" key={t.id}>
                      <span>{t.abbreviation || t.name}</span>
                      <span className="wl">{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}</span>
                    </div>
                  ))}
                </div>
              );
            }))}
          </aside>
        </div>
      </div>
    </div>
  );
}
