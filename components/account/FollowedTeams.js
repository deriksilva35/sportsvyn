'use client';

/**
 * FollowedTeams - "Teams you follow" on /account: the list, each row
 * removable, and a searchable add-by-league below it.
 *
 * ONE WRITER, THE SAME ONE. Every button here calls followTeam /
 * unfollowTeam from app/actions/follows.js - the same two server actions the
 * star on a team page and on a game header call. There is no account-only
 * endpoint, so there is no second place for the rules to drift to, and a
 * double-tap is safe because both writes are idempotent.
 *
 * OPTIMISTIC, SERVER-CONFIRMED, REVERTED ON FAILURE - the FollowStar pattern
 * applied to a list rather than one toggle. The optimistic state IS the list:
 * a removed row disappears before the round trip and comes back whole if the
 * action returns { ok: false }. The pre-change list is the revert target, so
 * a failure cannot leave a half-applied order.
 *
 * THE TEAM LIST SHIPS ONCE AND FILTERS IN THE BROWSER. Four leagues, a few
 * hundred teams; a search box that round-trips per keystroke on a list this
 * size is latency bought with nothing.
 *
 * THE ADDER IS CLOSED UNTIL ASKED FOR, and shows nothing until a league or a
 * query narrows it. Every team in the database unfurled under a list of three
 * is not a control, it is a directory with a heading.
 */

import { useMemo, useState, useTransition } from 'react';
import { followTeam, unfollowTeam } from '@/app/actions/follows';
import TeamMark from '@/components/team/TeamMark';
import './followedTeams.css';

const LEAGUE_LABEL = Object.freeze({
  nfl: 'NFL', cfb: 'CFB', epl: 'Premier League', 'fifa-wc-2026': 'World Cup',
});
const leagueLabel = (slug, fallback) => LEAGUE_LABEL[slug] ?? fallback ?? String(slug ?? '').toUpperCase();

// The searchable haystack for one team, built per row at filter time.
const hay = (t) => `${t.name} ${t.fullName ?? ''} ${t.abbreviation ?? ''} ${leagueLabel(t.leagueSlug, t.leagueName)}`.toLowerCase();

export default function FollowedTeams({ initialTeams = [], allTeams = [] }) {
  const [teams, setTeams] = useState(initialTeams);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [league, setLeague] = useState('all');
  const [, startTransition] = useTransition();

  const followedIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);
  const leagues = useMemo(() => {
    const seen = new Map();
    for (const t of allTeams) if (!seen.has(t.leagueSlug)) seen.set(t.leagueSlug, leagueLabel(t.leagueSlug, t.leagueName));
    return [...seen.entries()];
  }, [allTeams]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle && league === 'all') return [];
    let pool = league === 'all' ? allTeams : allTeams.filter((t) => t.leagueSlug === league);
    if (needle) pool = pool.filter((t) => hay(t).includes(needle));
    return pool.slice(0, 40);
  }, [q, league, allTeams]);

  function remove(team) {
    const before = teams;
    setTeams(before.filter((t) => t.id !== team.id));
    startTransition(async () => {
      const r = await unfollowTeam(team.id);
      if (!r?.ok) setTeams(before);
    });
  }

  function add(team) {
    if (followedIds.has(team.id)) return;
    const before = teams;
    setTeams([{ ...team, colors: team.colors ?? { primary: null, secondary: null } }, ...before]);
    startTransition(async () => {
      const r = await followTeam(team.id);
      if (!r?.ok) setTeams(before);
    });
  }

  return (
    <section className="acct-mod ft" data-section="followed-teams">
      <h2 className="acct-eyebrow">Teams you follow</h2>

      {teams.length === 0 ? (
        <p className="ft-empty">No teams yet. Following one marks its games as yours across the site.</p>
      ) : (
        <ul className="ft-list">
          {teams.map((t) => (
            <li className="ft-row" key={t.id} data-team-id={t.id}>
              <TeamMark primary={t.colors?.primary} secondary={t.colors?.secondary} abbr={t.abbreviation} size={24} title={t.fullName ?? t.name} />
              <a className="ft-name" href={`/team/${t.slug}`}>{t.name}</a>
              <span className="ft-lg">{leagueLabel(t.leagueSlug, t.leagueName)}</span>
              <button type="button" className="ft-x" aria-label={`Unfollow ${t.fullName ?? t.name}`} onClick={() => remove(t)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="ft-add" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
        {adding ? 'Done adding' : 'Follow a team'}
      </button>

      {adding && (
        <div className="ft-picker">
          <div className="ft-lgs">
            <button type="button" className={`ft-lg-pill${league === 'all' ? ' on' : ''}`} onClick={() => setLeague('all')}>All</button>
            {leagues.map(([slug, label]) => (
              <button key={slug} type="button" className={`ft-lg-pill${league === slug ? ' on' : ''}`} onClick={() => setLeague(slug)}>{label}</button>
            ))}
          </div>
          <input className="ft-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams" aria-label="Search teams" autoComplete="off" />
          {results.length === 0 ? (
            <p className="ft-hint">{q.trim() ? 'No team matches that.' : 'Pick a league, or start typing.'}</p>
          ) : (
            <ul className="ft-results">
              {results.map((t) => {
                const on = followedIds.has(t.id);
                return (
                  <li className="ft-result" key={t.id}>
                    <span className="ft-name">{t.name}</span>
                    <span className="ft-lg">{leagueLabel(t.leagueSlug, t.leagueName)}</span>
                    <button
                      type="button" className={`ft-plus${on ? ' on' : ''}`} disabled={on}
                      aria-label={on ? `Already following ${t.fullName ?? t.name}` : `Follow ${t.fullName ?? t.name}`}
                      onClick={() => add(t)}
                    >{on ? 'Following' : 'Follow'}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
