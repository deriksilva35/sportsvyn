// components/gridiron/TodayV2.js - the Today tab, per
// docs/design/mocks/today-tab-v0_1.html.
//
// A server component: it draws what lib/gridiron/todayV2.js read. Blocks in
// the mock's order - read, Weekly, picks, Daily, your teams, the numbers, the
// wire - and every one of them renders NOTHING rather than an empty shell,
// which is the same law the league landing modules already follow.
//
// SIGNED OUT IS THE SAME PAGE MINUS THE PERSONAL BLOCKS (R3). The numbers
// block is byte-identical either way; only the four personal blocks are
// gated, and one "Nothing riding yet" card plus a "Kicking off" list stand in.

import Link from 'next/link';
import StandaloneTime from '@/components/StandaloneTime';
import TeamMark from '@/components/team/TeamMark';
import RankBadge from '@/components/gridiron/RankBadge';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { abbrOf } from '@/lib/gridiron/scoresV2Shape';
import { liveLabelOf } from '@/lib/gridiron/todayReads';
import './todayV2.css';

const LEAGUE_LABEL = Object.freeze({ nfl: 'NFL', cfb: 'CFB', epl: 'EPL' });
const SLOT_LABEL = (slot) => String(slot ?? '').replace(/\d+$/, '');
// PASSING/RUSHING/RECEIVING in a 4ch column. slice(0,4) turned RECEIVING into
// "RECE", which is not a word - the short forms are named rather than cut.
const STAT_SHORT = Object.freeze({ pass: 'PASS', rush: 'RUSH', rec: 'REC' });

function SectionHead({ title, href, label }) {
  return (
    <div className="tv-sh">
      <h3>{title}</h3>
      {href ? <Link href={href}>{label}</Link> : null}
    </div>
  );
}

// ---- the read strip ------------------------------------------------------
// R2: no football article, no strip. Not a placeholder, and never a soccer
// piece - latestRead() constrains the league in SQL.
function ReadStrip({ read }) {
  if (!read) return null;
  return (
    <Link className="tv-read" href={read.href} data-section="read">
      <div className="tv-eb q">The read</div>
      <h4>{read.title}</h4>
      {read.dek ? <p>{read.dek}</p> : null}
      <span className="tv-go">Read the card{read.readMin ? ` · ${read.readMin} min` : ''} &rarr;</span>
    </Link>
  );
}

// ---- the Weekly hero -----------------------------------------------------
function SlotRow({ row, game }) {
  const live = game?.status === 'live';
  const final = game?.status === 'final';
  // THE THREE STATES THE MOCK ASKS FOR: final, live with period and clock, or
  // the kickoff time. The state is the GAME's, matched to the player by team
  // abbreviation - the same join stakeForMatches performs.
  const state = final ? 'final'
    : live ? (liveLabelOf('live', game.metadata) ?? 'Live').replace(/^Live · /, '')
      : null;
  // NOT STARTED IS A WORD, NOT A ZERO. A 0 beside a player who has not played
  // is not a low score, it is a wrong one - the same rule the game cards use.
  const started = row.played || live || final;
  return (
    <div className={`tv-pr${row.played ? ' done' : ''}`} data-slot={row.slot} data-game={state ?? 'scheduled'}>
      <span className="pos">{SLOT_LABEL(row.slot)}</span>
      <span className="who">
        {row.name ?? <i className="tv-unset">Not set</i>}
        {row.team ? (
          <small>
            {row.team}
            {state ? ` · ${state}` : null}
            {!state && game?.kickoffAt ? <> · <StandaloneTime iso={game.kickoffAt} /></> : null}
          </small>
        ) : null}
      </span>
      {started
        ? <b className={`n${live ? ' live' : ''}`}>{row.points}</b>
        : <span className="st">Not started</span>}
    </div>
  );
}

function WeeklyHero({ hero, gamesByTeam }) {
  if (!hero) return null;
  const pct = hero.slots ? Math.round((hero.playedCount / hero.slots) * 100) : 0;
  return (
    <>
      <SectionHead title="The Weekly" href="/weekly" label="Lineup &rarr;" />
      <div className="tv-hero" data-section="weekly">
        <div className="tv-row1">
          <div>
            <div className="tv-eb q">{hero.settled ? 'Final' : 'Live'}</div>
            <div className="tv-big n">{hero.total}</div>
          </div>
          {/* THE RANK IS PRINTED EVEN AT "#1 of 1" (Q4). A rank line that hides
              itself when the field is small teaches nobody anything. */}
          {hero.rank != null && (
            <div className="tv-rk"><b className="n">#{hero.rank}</b><span>of {hero.of}</span></div>
          )}
        </div>
        <div className="tv-bar"><i style={{ width: `${pct}%` }} /></div>
        <div className="tv-barc">
          <span>{hero.playedCount} of {hero.slots} played</span>
          {hero.leader != null ? <span>leader {hero.leader}</span> : null}
        </div>
        {hero.rows.map((r) => (
          <SlotRow key={r.slot} row={r} game={r.team ? gamesByTeam.get(r.team) ?? null : null} />
        ))}
      </div>
    </>
  );
}

// ---- the picks strip -----------------------------------------------------
const TONE = { won: ' good', lost: ' bad', live: '', pending: '' };
function PicksCard({ picks }) {
  if (!picks || !picks.leagues.length) return null;
  const shown = picks.chips.filter((c) => c.state !== 'pending');
  const pending = picks.pendingPicked + picks.unpicked;
  return (
    <>
      <SectionHead title="Your picks" href={`/pickem/${picks.leagues[0].sport}`} label="Board &rarr;" />
      <div className="tv-card" data-section="picks">
        <div className="tv-chips">
          {shown.map((c) => (
            <span key={c.matchId} className={`tv-chip${TONE[c.state] ?? ''}`} data-state={c.state}>
              {c.abbr} <b>{c.state === 'won' ? '✓' : c.state === 'lost' ? '✗' : 'live'}</b>
            </span>
          ))}
          {pending > 0 ? <span className="tv-chip q">{pending} pending</span> : null}
        </div>
        <div className="tv-foot">
          <span>{picks.leagues.map((l) => <span key={l.sport}>{l.label} <b>{l.record.wins}-{l.record.losses}</b>{' '}</span>)}</span>
          {picks.nextLock ? <span>next lock <StandaloneTime iso={picks.nextLock} /></span> : null}
        </div>
      </div>
    </>
  );
}

// ---- the Daily -----------------------------------------------------------
function DailyCard({ daily, signedIn, signinHref }) {
  if (!daily?.board) return null;
  const done = Boolean(daily.run?.completedAt);
  const started = Boolean(daily.run) && !done;
  return (
    <Link className="tv-daily" href={signedIn ? '/daily/board' : signinHref('/daily/board')} data-section="daily">
      <div>
        <div className="tv-dt">The Daily</div>
        <div className="tv-ds">
          {done ? 'Played today' : started ? 'In progress' : 'Not played'}
          {daily.board.closesAt ? <> · closes <StandaloneTime iso={daily.board.closesAt} /></> : null}
        </div>
      </div>
      <span className="tv-dgo">{signedIn ? (done ? 'See your grade' : started ? 'Resume' : 'Play') : 'Sign in to play'}</span>
    </Link>
  );
}

// ---- your teams ----------------------------------------------------------
// R1: ALL followed teams, each with its live game if playing, else its next
// scheduled one. Not today-only - one gridiron follow would leave it empty
// most days.
function TeamRow({ t }) {
  const scored = t.status === 'live' || t.status === 'final';
  const mineScore = t.forHome ? t.homeScore : t.awayScore;
  const oppScore = t.forHome ? t.awayScore : t.homeScore;
  const won = scored && mineScore != null && oppScore != null && mineScore > oppScore;
  const lost = scored && mineScore != null && oppScore != null && mineScore < oppScore;
  return (
    <Link className="tv-gm" href={`/${t.leagueSlug}/game/${t.slug}`} data-team-id={t.followTeamId}>
      <TeamMark primary={t.mine?.colors?.primary} secondary={t.mine?.colors?.secondary} abbr={abbrOf(t.mine)} size={20} title={t.mine?.name ?? t.followName} />
      {t.rank != null ? <RankBadge rank={t.rank} /> : null}
      <span className="ab">{abbrOf(t.mine) || t.followName}</span>
      <span className="nm">{t.forHome ? 'vs' : 'at'} {abbrOf(t.opp) || t.opp?.name}</span>
      {scored
        ? <span className="sc n">{mineScore ?? 0}-{oppScore ?? 0}</span>
        : <span className="sc n"><StandaloneTime iso={t.kickoffAt} /></span>}
      {t.status === 'live'
        ? <span className="tag lv">{(t.liveLabel ?? 'Live').replace(/^Live · /, '')}</span>
        : t.status === 'final' ? <span className={`tag ${won ? 'w' : lost ? 'l' : ''}`}>{won ? 'W' : lost ? 'L' : 'T'}</span>
          : null}
    </Link>
  );
}

// ---- the numbers ---------------------------------------------------------
// IDENTICAL SIGNED IN OR OUT (R3). The only thing a session changes here is
// which rail chips wear the follow outline.
function Numbers({ v, signinHref }) {
  const isNfl = v.leagueSlug === 'nfl';
  const mine = (id) => id != null && v.followed?.has?.(id) === true;
  const others = ['nfl', 'cfb', 'epl'].filter((s) => s !== v.leagueSlug);
  return (
    <>
      <SectionHead title="The numbers" href={`/${v.leagueSlug}`} label={`${LEAGUE_LABEL[v.leagueSlug]} home →`} />
      <div className="tv-sw" data-section="switch">
        <span className="on">{LEAGUE_LABEL[v.leagueSlug]}</span>
        {others.map((s) => (
          <Link key={s} href={s === 'epl' ? '/epl/standings' : `/${s}`}>{LEAGUE_LABEL[s]}</Link>
        ))}
      </div>
      {v.chips.length > 0 && (
        <div className="tv-rail" data-section="rail">
          {v.chips.map((c) => (
            <Link key={`${c.rank}-${c.abbr}`} className={`tv-rchip${mine(c.teamId) ? ' mine' : ''}`}
              href={isNfl ? '/nfl/rankings?tab=power' : '/cfb/rankings'} data-team-id={c.teamId ?? undefined}>
              <div className="r">{c.rank}</div><div className="a">{c.abbr}</div>
              {c.record ? <div className="w">{c.record}</div> : null}
            </Link>
          ))}
        </div>
      )}
      {(v.leaders.length > 0 || v.snapshot) && (
        <div className="tv-two">
          {v.leaders.length > 0 && (
            <div className="tv-card">
              <div className="tv-eb q">Week leaders</div>
              <table className="tv-tbl"><tbody>
                {v.leaders.map((l) => (
                  <tr key={l.key}><td className="l">{STAT_SHORT[l.key] ?? l.label}</td><td className="v">{l.name} {l.yards}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
          {v.snapshot && (
            <div className="tv-card">
              <div className="tv-eb q">{v.snapshot.group}</div>
              <table className="tv-tbl"><tbody>
                {v.snapshot.rows.slice(0, 4).map((r) => (
                  <tr key={r.team_id}><td className="l">{r.abbreviation ?? r.short_name}</td><td className="v">{r.wins}-{r.losses}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function TodayV2({ v, isShell = false }) {
  const signinHref = (dest) => shellSigninHref(dest, isShell);
  // The Weekly hero needs each player's GAME. The slate is already on the
  // page for the kickoff list; matching by team abbreviation is the same join
  // stakeForMatches does, and it costs nothing extra.
  const gamesByTeam = new Map();
  for (const g of v.kicks) {
    for (const t of [g.home, g.away]) {
      const a = t?.abbreviation ?? abbrOf(t);
      if (a) gamesByTeam.set(a, { status: g.status, metadata: { live_state: g.liveState }, kickoffAt: g.kickoffAt });
    }
  }
  return (
    <div className="tv" data-surface="ink" data-signed-in={v.signedIn ? '1' : '0'}>
      <div className="tv-eb">{v.eyebrow}</div>
      <h1 className="tv-h1">{v.title}</h1>

      <ReadStrip read={v.read} />

      {v.signedIn ? (
        <>
          <WeeklyHero hero={v.hero} gamesByTeam={gamesByTeam} />
          <PicksCard picks={v.picks} />
          <DailyCard daily={v.daily} signedIn signinHref={signinHref} />
          {v.teams.length > 0 && (
            <>
              <SectionHead title="Your teams" href="/account" label="Edit &rarr;" />
              <div className="tv-card" data-section="teams">
                {v.teams.map((t) => <TeamRow key={t.followTeamId} t={t} />)}
              </div>
            </>
          )}
          {!v.riding && <NothingRiding signinHref={signinHref} signedIn />}
        </>
      ) : (
        <>
          <NothingRiding signinHref={signinHref} signedIn={false} />
          {v.kicks.length > 0 && (
            <>
              <SectionHead title="Kicking off" href="/scores" label="All scores &rarr;" />
              <div className="tv-card" data-section="kicks">
                {v.kicks.map((g) => (
                  <Link className="tv-gm" key={g.id} href={g.href}>
                    <span className="ab n"><StandaloneTime iso={g.kickoffAt} /></span>
                    <span className="nm">{abbrOf(g.away)} at {abbrOf(g.home)}</span>
                    <span className="sc line">{spreadLabel(g)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Numbers v={v} signinHref={signinHref} />

      {v.wire.items.length > 0 && (
        <>
          <SectionHead title="The wire" href={`/${v.leagueSlug}/wire`} label="All &rarr;" />
          <div className="tv-card" data-section="wire">
            {v.wire.items.slice(0, 3).map((w) => (
              <a className="tv-wire" key={w.id} href={w.url}>
                <span className={`ln${w.lane === 'MOVE' ? '' : ' q'}`}>{w.lane}</span>
                <p>{w.headline}<small>{w.source}</small></p>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function spreadLabel(g) {
  if (g.spreadHome == null) return '';
  const n = Number(g.spreadHome);
  const side = n < 0 ? abbrOf(g.home) : abbrOf(g.away);
  const v = Math.abs(n);
  return `${side} ${n === 0 ? 'PK' : `-${v}`}`;
}

function NothingRiding({ signinHref, signedIn }) {
  return (
    <div className="tv-empty" data-section="empty">
      <h4>Nothing riding yet</h4>
      <p>Set six players, pick fourteen games, or play today&apos;s Daily. Then this page is yours.</p>
      <Link href={signedIn ? '/daily/board' : signinHref('/daily/board')}>Start with the Daily</Link>
    </div>
  );
}
