'use client';

/**
 * components/rankings/AllTeams.js - the one list (item 3).
 *
 * THIS IS THE FOLLOW UI. Every row carries Follow / Following, and both call
 * the same two server actions the team-page star calls - there is no
 * list-only endpoint, so the cap and the rules cannot drift.
 *
 * THE CAP IS THE SERVER'S (R4). The button does not pre-empt it: the sixth
 * follow is SENT and refused, and the refusal names the number, because a
 * button that greys itself out teaches nothing and a client-side count is one
 * more place to be wrong. The reply flips the row back and states the cap.
 *
 * SEARCH FILTERS NAME AND ABBREVIATION, in the browser. A few hundred teams
 * ship once; a keystroke round trip on a list this size is latency bought
 * with nothing.
 *
 * THE LEFT COLUMN IS THE POWER RANK, AND IT USED TO BE THE AP RANK (R2).
 * R2's reason was that "there is no 138-team power ranking to put there, and
 * inventing an order would be the pretending this tab exists not to do" -
 * which was true until lib/rankings/publishGridironEdition.js started
 * computing one over every final PROD holds. There is one now, it covers the
 * whole FBS field, and it is not invented.
 *
 * THE AP RANK MOVED INTO THE SUB-LINE, where the poll is one fact about a
 * team beside its conference and its record, rather than the spine of the
 * list. It appears only where the AP ranks the team; an unranked team's
 * sub-line simply does not mention a poll, which is different from saying it
 * is unranked 138 times.
 */

import { useMemo, useState, useTransition } from 'react';
import { followTeam, unfollowTeam } from '@/app/actions/follows';
import TeamMark from '@/components/team/TeamMark';
import './rankings.css';

const hay = (t) => `${t.name} ${t.fullName ?? ''} ${t.abbreviation ?? ''}`.toLowerCase();

export default function AllTeams({ league, label, teams = [], initialFollowed = [], signedIn = false, signinHref = '/signin' }) {
  const [followed, setFollowed] = useState(() => new Set(initialFollowed));
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const [, startTransition] = useTransition();

  const needle = q.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? teams.filter((t) => hay(t).includes(needle)) : null),
    [needle, teams],
  );
  const groups = useMemo(() => {
    const by = new Map();
    for (const t of teams) {
      const k = t.group || 'Other';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(t);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [teams]);

  function toggle(t) {
    if (!signedIn) return;
    const on = followed.has(t.id);
    const before = new Set(followed);
    const next = new Set(followed);
    if (on) next.delete(t.id); else next.add(t.id);
    setFollowed(next); setErr(null);
    startTransition(async () => {
      const r = on ? await unfollowTeam(t.id) : await followTeam(t.id);
      if (!r?.ok) {
        setFollowed(before);
        setErr(r?.reason === 'cap_reached'
          ? `You can follow ${r.cap} ${label} teams. Remove one to add another.`
          : 'That did not save. Try again.');
      }
    });
  }

  const Row = (t) => {
    const on = followed.has(t.id);
    return (
      <div className="rk-row" key={t.id} data-team-id={t.id}>
        <span className="rnk-n">{t.powerRank ?? '–'}</span>
        <TeamMark primary={t.colors?.primary} secondary={t.colors?.secondary} abbr={t.abbreviation}
          size={22} title={t.fullName ?? t.name} className={on ? 'rk-mark fol' : 'rk-mark'} />
        <span className="rnk-nm">{t.name}<small>{[t.group, t.record, t.apRank == null ? null : `AP ${t.apRank}`].filter(Boolean).join(' · ')}</small></span>
        {signedIn ? (
          <button type="button" className={`rk-fol${on ? ' on' : ''}`} aria-pressed={on}
            aria-label={`${on ? 'Unfollow' : 'Follow'} ${t.fullName ?? t.name}`} onClick={() => toggle(t)}>
            {on ? 'Following' : 'Follow'}
          </button>
        ) : (
          <a className="rk-fol" href={signinHref}>Follow</a>
        )}
      </div>
    );
  };

  return (
    <div className="rnk" data-surface="ink" data-list="all-teams">
      <div className="rk-crumb"><a href={`/rankings?league=${league}`}>← Rankings · {label}</a></div>
      <h1 className="rk-h1">All {teams.length}</h1>
      <div className="rk-search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search teams" aria-label="Search teams" autoComplete="off" />
      </div>
      {err ? <p className="rk-err" role="status">{err}</p> : null}
      {matches ? (
        <section className="rk-mod" data-module="matches">
          <div className="rk-hd"><span className="rk-eb">{matches.length} match{matches.length === 1 ? '' : 'es'}</span></div>
          {matches.length === 0 ? <p className="rk-note">No team matches that.</p> : matches.map(Row)}
        </section>
      ) : (
        <section className="rk-mod" data-module="groups">
          {groups.map(([name, rows]) => (
            <div key={name}>
              <div className="rk-conf">{name} · {rows.length}</div>
              {rows.map(Row)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
