// components/my/panels.js - the nine dashboard panels, mock v0_2 grammar.
//
// One file because they share one shell and one row; nine files of six lines
// each would be nine imports and a directory to scan. Anything that grows its
// own behaviour (the filterable Watch board) is its own client component.

import { Mod, Row, Prompt, StatePill } from './Mod';
import { rowState } from '@/lib/today/slateRow';
import { lockLabel } from '@/lib/pickem/read';

const LG = { cfb: 'CFB', nfl: 'NFL', epl: 'EPL' };
const side = (g) => `${g.away?.abbreviation ?? g.away?.name} at ${g.home?.abbreviation ?? g.home?.name}`;
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
const dayOf = (iso) => (iso ? DAY.format(new Date(iso)).toUpperCase() : '');

// ---------------------------------------------------------------- contests

/**
 * MY CONTESTS - the four games in one card, which is why it leads.
 * Weekly and Draft read null before Sep 8; that is a real state, so they render
 * the SOON pill and their open date rather than being hidden.
 */
export function ContestsPanel({ daily, yesterday, pickem, weekly, draft }) {
  return (
    <Mod tag="My Contests - all four games">
      <Row
        label="The Daily"
        sub={yesterday?.played ? `Ed. ${yesterday.edition} - played` : `Ed. ${daily?.edition ?? '-'} - open`}
        // The screen's ONE volt number, by mock ruling.
        value={yesterday?.played && yesterday.score != null ? yesterday.score : 'Play'}
        valueClass={yesterday?.played && yesterday.score != null ? 'volt' : undefined}
      />
      <Row
        label="Pick'em"
        sub={pickem ? `Board 1 - locks ${lockLabel(pickem.nextKickoff)}` : 'No open board'}
        value={pickem ? <>{pickem.picked}/{pickem.total} <span className="mut">picked</span></> : '-'}
      />
      <Row label="The Weekly" sub={weekly ? 'open' : 'opens Mon Sep 8'}
        value={weekly ? 'Open' : <StatePill>Soon</StatePill>} />
      <Row label="The Draft" sub={draft ? 'open' : 'opens Mon Sep 8'}
        value={draft ? 'Open' : <StatePill>Soon</StatePill>} />
    </Mod>
  );
}

// ------------------------------------------------------------------ pickem

/** Rows the panel shows before the overflow line. */
export const PICKEM_VISIBLE = 4;

/**
 * MY PICK'EM - honest per-game locking.
 *
 * A game whose kickoff has passed is LOCKED, and if it was never picked it
 * renders locked rather than pickable. Showing an unpicked locked game as
 * still actionable is the one thing this panel must not do.
 */
export function PickemPanel({ view }) {
  if (!view?.games?.length) {
    return (
      <Mod tag="My Pick'em">
        <p className="empty">No open board right now.</p>
      </Mod>
    );
  }
  const games = view.games;
  const shown = games.slice(0, PICKEM_VISIBLE);
  const restUnpicked = games.slice(PICKEM_VISIBLE).filter((g) => !g.my_side).length;
  return (
    <Mod tag={`My Pick'em - Board 1 - ${games.length} games`}
      cta="Open the board" ctaHref="/pickem">
      {shown.map((g) => {
        const picked = !!g.my_side;
        const locked = !!g.kicked;
        const pickedName = g.my_side === 'home' ? g.home : g.away;
        return (
          <Row key={g.match_id}
            label={`${g.away} at ${g.home}`}
            sub={picked ? `your pick: ${pickedName}`
              : locked ? 'locked - no pick' : `locks ${lockLabel(g.kickoff_at)}`}
            value={picked ? pickedName : locked ? 'LOCKED' : '- -'}
            valueClass={picked ? 'jade' : 'mut'}
          />
        );
      })}
      {restUnpicked > 0
        ? <Row muted label={`+ ${restUnpicked} more unpicked`} value="" />
        : null}
    </Mod>
  );
}

// ----------------------------------------------------------------- fantasy

const FMT = { ppr: 'PPR', half: 'Half', standard: 'Standard' };
const SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });

/**
 * MY FANTASY - draft history only, by ruling.
 *
 * The Exposure Report EXISTS (lib/sim/exposureReport.js, with tests) and is
 * linked rather than inlined: this relay was scoped to draft history, and
 * surfacing a second aggregate here would have been building past the brief.
 */
export function FantasyPanel({ drafts }) {
  if (!drafts?.length) {
    return (
      <Mod tag="My Fantasy">
        <Prompt line="No mock drafts yet. The room fills with AI that reach and slide like real drafters."
          cta="Start a mock draft" ctaHref="/sim" />
      </Mod>
    );
  }
  return (
    <Mod tag="My Fantasy - recent drafts" cta="Open tracker" ctaHref="/sim/tracker">
      {drafts.slice(0, 3).map((d) => (
        <Row key={d.id}
          label={`Mock - ${d.teams_count}-team ${FMT[d.scoring_format] ?? d.scoring_format}`}
          sub={d.started_at ? SHORT.format(new Date(d.started_at)) : null}
          value={d.status === 'in_progress'
            ? <span className="mut">in progress</span>
            : <>Best-6 <b>{d.grade ?? '-'}</b></>}
        />
      ))}
      <a className="cta2" href="/sim/account">Exposure report &rarr;</a>
    </Mod>
  );
}

// ------------------------------------------------------------- today / live

/** PRE is visible and labelled, never hidden - the front page's law. */
function GameRow({ g }) {
  const { isPreseason, when, live } = rowState(g);
  return (
    <Row
      label={<>{LG[g.leagueSlug] ?? g.leagueSlug} &middot; {side(g)}
        {isPreseason ? <> <StatePill>PRE</StatePill></> : null}</>}
      sub={live ? 'in play' : when}
      value={live ? <><span className="livedot" />LIVE</> : dayOf(g.kickoffAt)}
      valueClass={live ? 'livec' : 'mut'}
    />
  );
}

export function TodayNextPanel({ games }) {
  if (!games?.length) {
    return <Mod tag="Today & Next"><p className="empty">Nothing scheduled.</p></Mod>;
  }
  return (
    <Mod tag="Today & Next - across your leagues">
      {games.map((g) => <GameRow key={g.id} g={g} />)}
    </Mod>
  );
}

export function LiveNowPanel({ games }) {
  return (
    <Mod tag="Live Now">
      {games?.length
        ? games.map((g) => <GameRow key={g.id} g={g} />)
        : <p className="empty">No live games right now.</p>}
    </Mod>
  );
}

// ---------------------------------------------------------------- rankings

/**
 * AP TOP 25, top five. Poll selection is BY NAME upstream and never by index -
 * AP and Coaches arrive in one payload and their order is the provider's.
 *
 * MOVEMENT IS FREE, not new derivation: pollTable already returns previousRank
 * and movement per row. It is null for every row today because week 1 is the
 * first poll of the season and there is no prior week to move from - so the
 * panel states that rather than printing a column of dashes.
 */
export function RankingsPanel({ poll }) {
  if (!poll?.length) {
    return <Mod tag="AP Top 25"><p className="empty">The poll has not been published yet.</p></Mod>;
  }
  return (
    <Mod tag="AP Top 25" cta="All rankings" ctaHref="/cfb/rankings">
      {poll.slice(0, 5).map((r) => (
        <Row key={r.rank} label={<><span className="mut">{r.rank}</span>&nbsp; {r.team}</>}
          sub={r.movement ? `${r.movement > 0 ? '+' : ''}${r.movement} from last week` : null}
          value={r.points ?? '-'} valueClass="mut" />
      ))}
      {poll.every((r) => r.movement == null)
        ? <Row muted label="Movement begins wk 2" value="" />
        : null}
    </Mod>
  );
}

// ------------------------------------------------------- schedule / players

export function SchedulePanel({ games }) {
  if (!games?.length) {
    return (
      <Mod tag="Your Schedule">
        <Prompt line="Follow teams to see their next games land here. Every team page has a follow button."
          cta="Browse teams" ctaHref="/scores" />
      </Mod>
    );
  }
  return (
    <Mod tag="Your Schedule - teams you follow">
      {games.map((g) => {
        const { isPreseason, when } = rowState(g);
        const opp = g.home?.abbreviation === g.followName ? `vs ${g.away?.abbreviation}` : `at ${g.home?.abbreviation}`;
        return (
          <Row key={`${g.followTeamId}-${g.id}`}
            label={g.followName}
            sub={<>{LG[g.leagueSlug] ?? g.leagueSlug} &middot; {opp}
              {isPreseason ? <> <StatePill>PRE</StatePill></> : null}</>}
            value={`${dayOf(g.kickoffAt)} ${when}`} valueClass="mut" />
        );
      })}
    </Mod>
  );
}

export function YourPlayersPanel({ players }) {
  if (!players?.length) {
    return (
      <Mod tag="Your Players">
        <Prompt line="Follow players to see their lines land here every week. Every player page has a follow button."
          cta="Browse players" ctaHref="/cfb" />
      </Mod>
    );
  }
  return (
    <Mod tag="Your Players - players you follow">
      {players.map((p) => (
        <Row key={p.id} label={p.name}
          sub={`${LG[p.leagueSlug] ?? p.leagueSlug ?? ''} - ${p.team ?? 'free agent'}`}
          value={p.position ?? '-'} valueClass="mut" />
      ))}
    </Mod>
  );
}
