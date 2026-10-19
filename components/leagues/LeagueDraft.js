// components/leagues/LeagueDraft.js - THE DRAFT TAB of a league that holds a
// Fantrax draft (Leagues slice 3, option B, fri-3). Server component; the data is
// lib/leagues/draftLink.js loadDraftHome().
//
//   status     the draft date (or "No date set"), teams, scoring, keepers, and
//              "Empty seats: bots on/off" - the commissioner's switch
//   your team  the franchise you claimed, or a picker of the open ones
//   board      every franchise in draft order: manager and its keepers by round
//   your mocks your own completed runs (runs are private - leagueShare's ruling)
//
// Nothing here writes draft facts: a claim is the reader's own row
// (claimFranchise), the switch is the league owner's (setBotsOn).

import Link from 'next/link';
import { SCORING_LABEL } from '@/lib/fantasy/config';
import { dateLabel } from '@/lib/time/display';
import { ClaimTeam, BotsToggle } from '@/components/leagues/LeagueDraftControls';

const who = (m, uid) => (m == null ? null : m.userId === uid ? 'You' : m.handle ? `@${m.handle}` : 'A member');

export default function LeagueDraft({ league, draft, uid, isOwner }) {
  if (!draft) return <p className="lv-empty">The draft could not load. Pull to refresh.</p>;
  const { config, franchises, keeperCount, me, runs } = draft;
  const open = franchises.filter((f) => f.manager == null);
  const date = config.draft_date ? dateLabel(config.draft_date, { tz: null }) : null;
  const past = config.draft_date && new Date(config.draft_date) <= new Date();
  return (
    <section aria-label="Draft" data-draft>
      <div className="lh-draft-status" data-draft-status>
        <span className="lh-kicker" style={{ margin: 0 }}>{past ? 'Drafted' : 'Draft day'}</span>
        <b>{date ?? 'No date set'}</b>
        <span className="lv-note">
          {config.teams_count} teams · {SCORING_LABEL[config.scoring_format] ?? config.scoring_format}
          {keeperCount ? ` · ${keeperCount} keepers` : ''}
        </span>
        <div className="lh-draft-bots" data-bots={league.bots_on ? 'on' : 'off'}>
          <span>Empty seats: <b>{league.bots_on ? 'bots fill them' : 'stay empty'}</b></span>
          {isOwner && <BotsToggle leagueId={league.id} on={!!league.bots_on} />}
        </div>
      </div>

      <p className="lh-kicker">Your team</p>
      {me.claimed ? (
        <p className="lh-draft-mine" data-my-team={me.claimed.slot}>Pick {me.claimed.slot} · <b>{me.claimed.name}</b></p>
      ) : open.length ? (
        <ClaimTeam configId={config.id} options={open.map((f) => ({ id: f.fantraxTeamId, label: `${f.slot}. ${f.name}` }))} />
      ) : (
        <p className="lv-note">Every team is claimed.</p>
      )}

      <p className="lh-kicker">The board · {franchises.length} teams</p>
      <div className="lh-board" data-board>
        {franchises.map((f) => (
          <div className={`lh-franchise${f.manager?.userId === uid ? ' lh-row--me' : ''}`} key={f.fantraxTeamId} data-franchise={f.slot}>
            <span className="lh-rank">{f.slot}</span>
            <span className="lh-who">
              <span className="lh-name"><span className="lh-handle">{f.name}</span></span>
              <span className="lh-sub">{who(f.manager, uid) ?? 'Open'}{f.keepers.length ? ` · ${f.keepers.length} kept` : ''}</span>
              {f.keepers.length > 0 && (
                <span className="lh-keepers" data-keepers={f.keepers.length}>
                  {f.keepers.map((k) => (
                    <span key={`${k.round}-${k.name}`} className="lh-keeper">R{k.round} {k.name}{k.position ? ` ${k.position}` : ''}</span>
                  ))}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <p className="lh-kicker">Your mock drafts</p>
      {runs.length ? runs.map((r) => (
        <Link key={r.draftId} className="lh-run" href={`/sim/draft/${r.draftId}`} data-run={r.draftId}>
          <span>{r.franchise ?? `Seat ${r.seat}`}</span>
          <span className="lv-note">{r.firstPicks.map((p) => p.name).join(', ')}</span>
        </Link>
      )) : <p className="lv-note">None yet. Mocks are private: only you see yours.</p>}
      <p className="lv-foot"><Link className="lv-btn lv-btn--primary" href="/sim" data-run-mock>Run a mock draft</Link></p>
    </section>
  );
}
