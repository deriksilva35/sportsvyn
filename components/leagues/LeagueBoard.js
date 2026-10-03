// components/leagues/LeagueBoard.js - THE LEAGUE PAGE for a member (canvas
// "Leagues V1", board League; the guillotine board is P3): the header with its
// status kicker and INVITE, the three numbers (your place, back of 1st, this
// week so far), the STANDINGS | THIS WEEK | MEMBERS rail, and the rule line.
// Server component: everything is computed in lib/leagues/table.js.

import Link from 'next/link';
import InviteSheet from '@/components/leagues/InviteSheet';
import { ordinal } from '@/lib/leagues/standings';
import { gameLabel, summaryLine, startLabel, rankPointsCopy } from '@/lib/leagues/settings';
import { hasStarted } from '@/lib/leagues/describe';
import { leagueHref, LEAGUE_TABS, pickemBoardLinks } from '@/lib/leagues/nav';


const fmt = (x) => (Number.isInteger(x) ? String(x) : Number(x).toFixed(1));
const who = (r, uid) => (r.userId === uid ? 'You' : r.handle ? `@${r.handle}` : 'A member');
const gamesLine = (games = []) => games
  .slice().sort((a, b) => a.place - b.place)
  .map((g) => `${gameLabel(g.game)}${g.sport !== 'all' && g.sport !== 'nfl' ? ` ${g.sport.toUpperCase()}` : ''} ${ordinal(g.place)}`)
  .join(' · ');

function Move({ m }) {
  if (m == null || m === 0) return <span className="lv-move">&middot;</span>;
  return <span className={`lv-move ${m > 0 ? 'lv-move--up' : 'lv-move--down'}`}>{m > 0 ? `+${m}` : `−${-m}`}</span>;
}

export default function LeagueBoard({ league, table, uid, tab = 'standings', openInvite = false, now = new Date() }) {
  const { standings, thisBucket, unit } = table;
  const unitWord = unit === 'week' ? 'week' : 'day';
  const started = hasStarted(league, now);
  const kicker = !started
    ? `Starts ${startLabel({ startsAt: league.starts_at ? new Date(league.starts_at).toISOString() : null, startWeek: league.start_week }) ?? 'soon'}`
    : table.liveLabel ? `${table.liveLabel}${table.liveFinal ? ' · final' : ' · live'}` : 'Live';
  const me = standings.rows.find((r) => r.userId === uid) ?? null;
  const lead = standings.rows[0] ?? null;
  const meNow = thisBucket.rows.find((r) => r.userId === uid) ?? null;
  const hasTable = standings.buckets.length > 0;
  const isOwner = league.owner_id != null && Number(league.owner_id) === uid;
  const n = league.members.length;

  return (
    <div className="lv lv-league">
      <header className="lv-lhead">
        <div className="lv-lhead-top">
          <span className="lv-kicker" style={{ padding: 0 }}>
            {league.format === 'guillotine' ? 'Guillotine · ' : ''}{kicker}
          </span>
          <span className="lv-lhead-invite">
            <InviteSheet
              league={{
                id: league.id, name: league.name, code: league.join_code, token: league.invite_token,
                members: n, max: league.max_members, lateJoins: league.late_joins,
                startLabel: startLabel({ startsAt: league.starts_at ? new Date(league.starts_at).toISOString() : null, startWeek: league.start_week }),
              }}
              isOwner={isOwner}
              openInitially={openInvite}
            />
          </span>
        </div>
        <h1 className="lv-lname">{league.name}</h1>
        <p className="lv-sub">{summaryLine(league)} · {n} {n === 1 ? 'member' : 'members'}</p>
        {table.guillotine ? (
          <div className="lv-tiles">
            <div className="lv-tile"><span className="lv-tile-k">You</span><span className="lv-tile-v">{table.guillotine.chopped.some((c) => c.userId === uid) ? 'OUT' : 'IN'}</span></div>
            <div className="lv-tile"><span className="lv-tile-k">Standing</span><span className="lv-tile-v">{table.guillotine.standing.length}</span></div>
            <div className="lv-tile"><span className="lv-tile-k">This {unitWord}</span><span className="lv-tile-v">{meNow ? fmt(meNow.current) : '—'}</span></div>
          </div>
        ) : (
          <div className="lv-tiles">
            <div className="lv-tile"><span className="lv-tile-k">You</span><span className="lv-tile-v">{me && hasTable ? ordinal(me.place).toUpperCase() : '—'}</span></div>
            <div className="lv-tile"><span className="lv-tile-k">Back of 1st</span><span className="lv-tile-v">{me && lead && hasTable ? fmt(Math.max(0, lead.total - me.total)) : '—'}</span></div>
            <div className="lv-tile"><span className="lv-tile-k">This {unitWord}</span><span className="lv-tile-v">{meNow ? fmt(meNow.current) : '—'}</span></div>
          </div>
        )}
      </header>

      <nav className="lv-seg lv-tabs" aria-label="League sections">
        {LEAGUE_TABS.map((t) => (
          <Link key={t.key} href={leagueHref(league.id, t.key)} aria-current={tab === t.key ? 'page' : undefined}
            className={tab === t.key ? 'on' : ''}>
            {t.key === 'week' ? `This ${unitWord}` : t.label}
          </Link>
        ))}
      </nav>

      {tab === 'standings' && table.guillotine && (
        <section aria-label="Guillotine">
          <div className="lv-standing"><b>{table.guillotine.standing.length}</b><span className="lv-note">of {n} still standing</span></div>
          <p className="lv-kicker">Still standing{table.liveLabel ? ` · ${table.liveLabel}${table.liveFinal ? '' : ' so far'}` : ''}</p>
          {table.guillotine.standing.map((r) => (
            <div className={`lv-grow${r.userId === uid ? ' lv-trow--me' : ''}`} key={r.userId} data-standing={r.userId}>
              <span className="lv-trow-name">{who(r, uid)}</span>
              <span className={`lv-gtag${r.onBlock ? ' lv-gtag--block' : ''}`}>{r.onBlock ? 'On the block' : 'Safe so far'}</span>
              <span className="lv-trow-t">{fmt(r.current)}</span>
            </div>
          ))}
          <p className="lv-note" style={{ padding: '10px 0' }}>
            Lowest score when the {unitWord} is final is out. A tie goes to the higher season total; tied on both, everyone tied survives.
          </p>
          {table.guillotine.chopped.length > 0 && (
            <>
              <p className="lv-kicker">Chopped · {table.guillotine.chopped.length}</p>
              {table.guillotine.chopped.map((c) => (
                <div className="lv-grow lv-grow--out" key={c.userId}>
                  <span className="lv-trow-name">{c.userId === uid ? 'You' : c.handle ? `@${c.handle}` : 'A member'}</span>
                  <span className="lv-gtag">Chopped · {c.label}</span>
                  <span className="lv-trow-t">&mdash;</span>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {tab === 'standings' && !table.guillotine && (
        hasTable ? (
          <section aria-label="Standings">
            <div className="lv-trow lv-trow--head">
              <span>#</span><span /><span>Player</span>
              <span>{unit === 'week' ? 'Last wk' : 'Last day'}</span><span>{league.span === 'season' ? 'Total' : 'Pts'}</span>
            </div>
            {standings.rows.map((r) => (
              <div className={`lv-trow${r.userId === uid ? ' lv-trow--me' : ''}`} key={r.userId} data-standing={r.userId}>
                <span className="lv-trow-n">{r.place}</span>
                <Move m={r.move} />
                <span className="lv-trow-who">
                  <span className="lv-trow-name">{who(r, uid)}</span>
                  <span className="lv-note">{gamesLine(r.games) || (r.current ? '' : `No entry this ${unitWord}`)}</span>
                </span>
                <span className="lv-trow-v">{fmt(r.current)}</span>
                <span className="lv-trow-t">{fmt(r.total)}</span>
              </div>
            ))}
          </section>
        ) : (
          <p className="lv-empty">
            {started ? `The table fills when the first ${unitWord} is final.` : `The table opens when the league starts - ${kicker.replace(/^Starts /, '')}.`}
          </p>
        )
      )}

      {tab === 'week' && (
        thisBucket.rows.some((r) => r.games.length) ? (
          <section aria-label={`This ${unitWord}`}>
            <p className="lv-kicker">{table.liveLabel}{table.liveFinal ? ' · final' : ' · so far'}</p>
            {thisBucket.rows.map((r) => (
              <div className={`lv-trow lv-trow--week${r.userId === uid ? ' lv-trow--me' : ''}`} key={r.userId}>
                <span className="lv-trow-n">{r.games.length ? r.place : '–'}</span>
                <span className="lv-trow-who">
                  <span className="lv-trow-name">{who(r, uid)}</span>
                  <span className="lv-note">{r.games.length ? r.games.map((g) => `${gameLabel(g.game)} ${fmt(g.score)}`).join(' · ') : 'Not in yet'}</span>
                </span>
                <span className="lv-trow-t">{fmt(r.current)}</span>
              </div>
            ))}
          </section>
        ) : (
          <p className="lv-empty">Nothing in yet this {unitWord}. Play, and your people will see it here.</p>
        )
      )}

      {tab === 'members' && (
        <section aria-label="Members">
          <p className="lv-kicker">{n} of {league.max_members} members</p>
          {league.members.map((m) => (
            <div className="lv-trow lv-trow--member" key={m.user_id}>
              <span className="lv-trow-name">{Number(m.user_id) === uid ? 'You' : m.handle ? `@${m.handle}` : 'A member'}</span>
              <span className="lv-note">{Number(m.user_id) === Number(league.owner_id) ? 'Owner' : `Joined ${new Date(m.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}`}</span>
            </div>
          ))}
        </section>
      )}

      <p className="lv-note lv-foot">
        {league.scoring === 'rank'
          ? `Rank points: ${rankPointsCopy(unitWord, n)} No entry scores 0; ties share the higher place.`
          : `Total points: each ${unitWord}'s ${league.games?.length === 1 ? gameLabel(league.games[0]) : 'game'} score, added up. No entry scores 0.`}
        {league.drop_worst && league.span === 'season' ? ` Each player's worst ${unitWord} is dropped.` : ''}
        {' '}Only final results count; this {unitWord} so far is on the second tab.
      </p>
      {/* THE LEAGUE'S OWN PICK'EM BOARDS - the board filtered to these members
          (/pickem/<sport>?league=<id>), one per Pick'em sport. */}
      {pickemBoardLinks(league.id, league.games).length > 0 && (
        <p className="lv-note lv-foot" data-pickem-links>
          League boards:{' '}
          {pickemBoardLinks(league.id, league.games).map((l, i) => (
            <span key={l.sport}>{i ? ' · ' : ''}<Link href={l.href}>{l.label}</Link></span>
          ))}
        </p>
      )}
    </div>
  );
}
