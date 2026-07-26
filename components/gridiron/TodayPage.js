// components/gridiron/TodayPage.js — shared server render for the /nfl and /cfb
// Today shells. Paper ground (data-surface="paper") with an ink instrument block
// (the week slate) sitting on it, per the Surface Rule. Local ink header + sport
// sub-nav; NO site header. DEV reads only.
import Wordmark from '@/components/gridiron/Wordmark';
import { getCurrentWeek, getNearestUpcomingWeek, getWeekSlate, getStandings, getLeagueIdBySlug } from '@/lib/gridiron/readers';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { getH2hOdds, getTitleContenders } from '@/lib/gridiron/oddsReader';
import { getGlobalMostDrafted, getAdpMovers } from '@/lib/sim/fantasyBoard';
import { normalizeTwoWayPct, isPreGame } from '@/lib/gridiron/oddsFormat';
import PlayoffPicture from '@/components/gridiron/PlayoffPicture';
import FantasyBoard from '@/components/gridiron/FantasyBoard';

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

export default async function TodayPage({ leagueSlug, leagueLabel, lede, tabs, contendersN = 12, standingsPhase = 'REG', searchParams }) {
  const sp = (await searchParams) ?? {};
  const now = new Date();
  const seasonYear = resolveSeasonYear(now);
  // Pin to the nearest UPCOMING week (the season opener during the offseason),
  // not the prior season's final slate; fall back to the latest started week.
  const upcoming = await getNearestUpcomingWeek(leagueSlug, seasonYear);
  const cur = upcoming ?? (await getCurrentWeek(leagueSlug, seasonYear));
  const phase = (sp.phase === 'POST' || sp.phase === 'REG') ? sp.phase : (cur?.seasonPhase ?? 'REG');
  const week = Number(sp.week) || cur?.week || 1;

  // Liveness cue on the lede kicker: how far out the opener is, read from the
  // nearest upcoming kickoff (data-driven, not a hardcoded date).
  const daysOut = upcoming?.kickoffAt
    ? Math.ceil((new Date(upcoming.kickoffAt).getTime() - now.getTime()) / 86400000)
    : null;
  const weeksOut = daysOut != null ? Math.round(daysOut / 7) : null;
  const cue = daysOut == null || daysOut <= 0 ? null
    : weeksOut >= 2 ? `${weeksOut} weeks out`
      : daysOut > 1 ? `${daysOut} days out`
        : 'kicks off tomorrow';

  const [slate, standings] = await Promise.all([
    getWeekSlate(leagueSlug, seasonYear, phase, week),
    getStandings(leagueSlug, seasonYear, standingsPhase),
  ]);
  // One batch odds read for the whole week's slate (no per-row fan-out).
  const oddsMap = await getH2hOdds(slate.byDay.flatMap((d) => d.games.map((g) => g.id)));

  // Instrument boards: the title-futures contenders (Playoff Picture) + the sim
  // fantasy reads. Each renders its real read or its dormant frame.
  const leagueId = await getLeagueIdBySlug(leagueSlug);
  const [contenders, fantasy, adp] = await Promise.all([
    leagueId ? getTitleContenders(leagueId, contendersN) : Promise.resolve([]),
    getGlobalMostDrafted(10),
    getAdpMovers(8),
  ]);

  return (
    <div className="gi" data-surface="paper">
      <header className="gi-head">
        <Wordmark href={`/${leagueSlug}`} />
        <nav className="gi-head-nav">
          <a href="/nfl">TODAY</a>
          <a href="/scores">SCORES</a>
          <a className={leagueSlug === 'nfl' ? 'active' : ''} href="/nfl">NFL</a>
          <a className={leagueSlug === 'cfb' ? 'active' : ''} href="/cfb">CFB</a>
          <a href="/world-cup-2026/bracket">SOCCER</a>
        </nav>
        <div className="gi-head-right"><a href="/my">MY SPORTSVYN</a><span className="gi-member">MEMBER</span></div>
      </header>

      <nav className="gi-subnav">
        {tabs.map((t) => <a key={t.label} className={t.active ? 'active' : ''} href={t.href}>{t.label}</a>)}
        <span className="gi-season">{seasonYear} SEASON · <b>{phase === 'POST' ? 'POSTSEASON' : `WEEK ${week}`}</b></span>
      </nav>

      {/* paper lede zone — one honest line, fitted to the register */}
      <section className="gi-lede">
        <div className="gi-lede-in">
          <div className="kick"><span className="sq" />{leagueLabel} · {seasonYear} SEASON{cue ? ` · ${cue}` : ''}</div>
          <h1>The Week in {leagueLabel}</h1>
          <p>{lede}</p>
        </div>
      </section>

      <div className="gi-wrap">
        <div className="gi-today-grid">
          {/* left column: the instrument stack (slate -> playoff picture -> fantasy) */}
          <div className="gi-today-left">
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

          <PlayoffPicture contenders={contenders} leagueLabel={leagueLabel} />
          <FantasyBoard adp={adp} mostDrafted={fantasy.mostDrafted} draftCount={fantasy.draftCount} />
          </div>

          {/* right: paper standings rail */}
          <aside className="gi-standings">
            <div className="gi-rail-h">{standingsPhase} Standings</div>
            {standings.length === 0 && (
              <div className="gi-standings-empty">Standings open once games go final.</div>
            )}
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
