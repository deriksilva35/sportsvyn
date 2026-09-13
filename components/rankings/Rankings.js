// components/rankings/Rankings.js - the Rankings tab, per
// docs/design/mocks/rankings-tab-v0_1.html and -v0_2-cfb.html.
//
// EVERY CONTROL IS A LINK (item 1). The league pills, the segment, the stat
// toggle and the game pills are all hrefs, so each view is a URL that can be
// shared and server-rendered with no client state.
//
// WHAT THE RULINGS TOOK OUT, and why nothing stands in its place:
//   R1 the AP module has no movement, no NEW badge and no dropped-out line -
//      one poll week exists on PROD and a diff needs two.
//   R3 the NFL power module has no movement column - no row carries a
//      previous_rank. A column of dashes is a promise the data cannot keep.
//   R5 CFB's touchdown module is TD LEADERS. A Golden Boot is a soccer
//      trophy, and this tab's whole argument is that it does not pretend.

import Link from 'next/link';
import Module from './Module.js';
import RankRow from './RankRow.js';
import { LEAGUE_LABEL, LEAGUES, VIEWS, GAMES, rankingsHref } from '@/lib/rankings/view';
import { STAT_KEYS, statLabel } from '@/lib/rankings/reads';
import './rankings.css';

const VIEW_LABEL = { teams: 'Teams', players: 'Players', people: 'People' };
const GAME_LABEL = { all: 'All games', weekly: 'Weekly', draft: 'Draft', pickem: "Pick'em", daily: 'Daily' };
const rec = (r) => (r.overall ?? null);

function Pills({ v }) {
  // PEOPLE HAS NO LEAGUES. Its pills are the games, because a person's
  // ranking is not a league's - the same row of chips, a different vocabulary.
  if (v.view === 'people') {
    return (
      <div className="rk-pills" data-pills="games">
        {GAMES.map((g) => (
          <Link key={g} className={`rk-pill${v.game === g ? ' on' : ''}`}
            href={rankingsHref({ league: v.league, view: 'people', game: g })}>{GAME_LABEL[g]}</Link>
        ))}
      </div>
    );
  }
  return (
    <div className="rk-pills" data-pills="leagues">
      {LEAGUES.map((l) => (
        <Link key={l} className={`rk-pill${v.league === l ? ' on' : ''}`}
          href={rankingsHref({ league: l, view: v.view, stat: v.stat })}>{LEAGUE_LABEL[l]}</Link>
      ))}
    </div>
  );
}

function Segment({ v }) {
  return (
    <div className="rk-seg" data-segment="view">
      {VIEWS.map((k) => (
        <Link key={k} className={v.view === k ? 'on' : ''}
          href={rankingsHref({ league: v.league, view: k, stat: v.stat, game: v.game })}>{VIEW_LABEL[k]}</Link>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ teams

function TeamsNfl({ v }) {
  const t = v.teams;
  return (
    <>
      {t.power.length > 0 && (
        <Module section="power" title={`Power · Week ${v.week}`} sub={v.signedIn ? 'your teams outlined' : null}
          href="/rankings/teams?league=nfl" cta="All 32 →">
          {t.power.map((r) => (
            <RankRow key={r.rank} rank={r.rank} name={r.name} team={r}
              followed={v.followed.has(r.teamId)} value={r.score} />
          ))}
        </Module>
      )}
      {t.division && (
        <Module section="group" title={t.division.group} sub={v.signedIn ? 'your division' : null}
          href={`/${v.league}/standings`} cta="Full standings →">
          {t.division.rows.map((r, i) => (
            <RankRow key={r.teamId} rank={i + 1} name={r.name} team={r}
              followed={v.followed.has(r.teamId)} value={rec(r)} />
          ))}
        </Module>
      )}
    </>
  );
}

function TeamsCfb({ v }) {
  const t = v.teams;
  return (
    <>
      {t.ap && (
        <Module section="ap" title={`AP Top 25 · Week ${t.ap.week}`} sub="points, not votes">
          {t.ap.rows.map((r) => (
            <RankRow key={r.rank} rank={r.rank} name={r.name} team={r}
              followed={v.followed.has(r.teamId)}
              value={r.points == null ? null : r.points.toLocaleString('en-US')} />
          ))}
        </Module>
      )}
      {t.ours.length > 0 && (
        <Module section="ours" title="Our Top 25" sub="editorial, not the poll">
          {t.ours.map((r) => (
            <RankRow key={r.rank} rank={r.rank} name={r.name} team={r}
              followed={v.followed.has(r.teamId)} sub={r.vsAp?.text ?? null} value={r.score} />
          ))}
        </Module>
      )}
      {t.conference && (
        <Module section="group" title={t.conference.group} sub={v.signedIn ? 'your conference' : null}
          href="/rankings/teams?league=cfb" cta="All 138 →">
          <div className="rk-cols"><span>CONF</span><span>OVR</span></div>
          {t.conference.rows.slice(0, 6).map((r, i) => (
            <RankRow key={r.teamId} rank={i + 1} name={r.name} team={r}
              followed={v.followed.has(r.teamId)} second={r.conf ?? '–'} value={rec(r)} />
          ))}
        </Module>
      )}
    </>
  );
}

function TeamsEpl({ v }) {
  const rows = v.teams.table?.rows ?? v.teams.table ?? [];
  if (!rows.length) return null;
  return (
    <Module section="table" title="Premier League" sub="the table">
      {rows.slice(0, 10).map((r, i) => (
        <RankRow key={r.teamId ?? r.team_id ?? i} rank={r.rank ?? i + 1}
          name={r.name ?? r.team_name} team={r}
          followed={v.followed.has(r.teamId ?? r.team_id)} value={r.points ?? r.pts ?? null} />
      ))}
    </Module>
  );
}

function YourTeams({ v }) {
  if (!v.signedIn) return null;
  return (
    <Module section="yours" title="Follow teams"
      note="Outlined teams are yours. Follow up to five per league and they sit outlined on every list here and first on Today."
      href={`/rankings/teams?league=${v.league}`} cta="Choose teams →" />
  );
}

// ----------------------------------------------------------------- players

function Players({ v }) {
  const p = v.players;
  return (
    <>
      {p.season.length > 0 && (
        <Module section="season" title="Season leaders" sub={`through Week ${v.week}`}>
          <div className="rk-tog" data-toggle="stat">
            {STAT_KEYS.map((k) => (
              <Link key={k} className={p.stat === k ? 'on' : ''}
                href={rankingsHref({ league: v.league, view: 'players', stat: k })}>{statLabel(k)}</Link>
            ))}
          </div>
          {p.season.map((r, i) => (
            <RankRow key={`${r.name}-${i}`} rank={i + 1} name={r.name} team={r}
              sub={[r.abbreviation, `${r.games} g`].filter(Boolean).join(' · ')} value={r.value} />
          ))}
        </Module>
      )}
      {p.fantasy && p.fantasy.length > 0 && (
        <Module section="fantasy" title="Fantasy · PPR · season" sub="your Weekly players marked">
          {p.fantasy.map((r, i) => (
            <RankRow key={`${r.name}-${i}`} rank={i + 1} name={r.name} team={r}
              followed={r.mine}
              sub={[r.abbreviation, r.mine ? 'in your six' : null].filter(Boolean).join(' · ')}
              value={r.value} />
          ))}
        </Module>
      )}
      {p.td && p.td.length > 0 && (
        <Module section="td" title="TD leaders" sub="rushing and receiving">
          {p.td.map((r, i) => (
            <RankRow key={`${r.name}-${i}`} rank={i + 1} name={r.name} team={r}
              sub={r.abbreviation} value={`${r.value} TD`} />
          ))}
        </Module>
      )}
      {p.week.length > 0 && (
        <Module section="week" title={`Week leaders · Week ${v.week}`}>
          {p.week.map((l) => (
            <RankRow key={l.key} rank={l.label.slice(0, 4)} name={l.name} sub={l.abbr} value={l.yards} />
          ))}
        </Module>
      )}
    </>
  );
}

// ------------------------------------------------------------------ people

function Seat({ seat }) {
  if (!seat) return null;
  return (
    <Module section="seat" title="The Draft · by seat"
      sub={`avg pts · min ${seat.minDrafters} drafters`} note={seat.note}>
      <div className="rk-seat">
        {seat.seats.map((s) => (
          <div key={s.seat} className={`${s.you ? 'you ' : ''}${s.avg == null ? 'none' : ''}`} data-seat={s.seat}>
            <small>S{s.seat}</small><b>{s.avg ?? '–'}</b>
          </div>
        ))}
      </div>
    </Module>
  );
}

function People({ v }) {
  const p = v.people;
  return (
    <>
      {p.mods.map((m) => (
        <Module key={m.key} section={m.key} title={m.title} sub={m.sub} href={m.href} cta="Full table →">
          {m.rows.map((r) => (
            <RankRow key={`${r.name}-${r.rank}`} rank={r.rank} name={r.name} sub={r.sub} value={r.value} you={r.you} />
          ))}
          {/* THE YOU ROW, when the reader is off the visible top. Same
              component, same bar, same pill as a ranked one - only the rank
              column differs, because the number is the thing they lack. */}
          {m.self ? <RankRow {...m.self} /> : null}
        </Module>
      ))}
      <Seat seat={p.seat} />
    </>
  );
}

export default function Rankings({ v }) {
  return (
    <div className="rk" data-surface="ink" data-league={v.league} data-view={v.view}
      data-signed-in={v.signedIn ? '1' : '0'}>
      <div className="rk-top">{v.eyebrow}</div>
      <h1 className="rk-h1">Rankings</h1>
      <Pills v={v} />
      <Segment v={v} />
      {v.view === 'teams' && (
        <>
          {v.teams.kind === 'nfl' ? <TeamsNfl v={v} />
            : v.teams.kind === 'cfb' ? <TeamsCfb v={v} /> : <TeamsEpl v={v} />}
          <YourTeams v={v} />
        </>
      )}
      {v.view === 'players' && <Players v={v} />}
      {v.view === 'people' && <People v={v} />}
    </div>
  );
}
