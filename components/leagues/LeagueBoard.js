// components/leagues/LeagueBoard.js - THE LEAGUE HOME for a member (Leagues
// Phase 1, slices 1-2, thu-4; Derik's approved mock "League home: standings,
// chat, members").
//
//   header   the date + LIVE eyebrow, INVITE, the name, "<games> · <span> ·
//            <scoring> · N members", and three tiles: YOU · LEAD (+ over 2nd)
//            or BACK OF 1ST · TODAY (THIS WEEK in a weekly league)
//   rail     STANDINGS · TODAY · CHAT · MEMBERS (lib/leagues/nav.js)
//   table    period chips (Season · This week · the last two final days), rows
//            of rank, name + ▲/▼ since the previous period, "days played ·
//            best", YESTERDAY and TOTAL; then "Latest in the league"
//   crew     a league of several games: game chips (All games · each game);
//            All games ranks by CREW POINTS (lib/leagues/crew.js) with the
//            explainer and "This week's leaders"; a game chip is that game's
//            own table
//
// Server component: every number is computed in lib/leagues/table.js and the
// words in lib/leagues/home.js. The guillotine board (P3) keeps its own section.

import Link from 'next/link';
import InviteSheet from '@/components/leagues/InviteSheet';
import { ShareLinkButton, MemberMenu, NotifyToggles, LeaveLeagueButton } from '@/components/leagues/LeagueMembersControls';
import { gameLabel, startLabel, rankPointsCopy, SPAN_LABEL, SCORING_LABEL } from '@/lib/leagues/settings';
import { hasStarted } from '@/lib/leagues/describe';
import { leagueHref, LEAGUE_TABS, pickemBoardLinks } from '@/lib/leagues/nav';
import { PICK_FORMAT_LABEL, leaguePlaysPickem, recordLine, switchOffer, pendingLine } from '@/lib/leagues/pickFormat';
import PickFormatSwitch, { PendingPickFormat } from '@/components/leagues/PickFormatSwitch';
import { fmtNum, fmtTile, statTiles, moveMark, subLine, tabLabel, eventLine } from '@/lib/leagues/home';
import { CREW_EXPLAINER, winsLine } from '@/lib/leagues/crew';
import { roleOf, menuFor, ROLE_LABEL } from '@/lib/leagues/members';
import { dateLabel } from '@/lib/time/display';

const who = (r, uid) => (r.userId === uid ? 'You' : r.handle ? `@${r.handle}` : 'A member');

// A sports week starts Tuesday 00:00 ET, so its date is read in ET (tz null).
const fmtFrom = (iso) => dateLabel(iso, { weekday: false, tz: null });
/** "THU, OCT 15" - the sports day (ET). */
const eyebrowDate = (now) => dateLabel(now, { tz: null }).replace(' ', ', ').toUpperCase();

/** "Pick'em scores Confidence: a right pick scores its rank." (+ the switch's line) */
function pickFormatLine(lg) {
  const f = lg.pick_format ?? 'regular';
  const how = f === 'confidence' ? 'a right pick scores its rank number'
    : f === 'ats' ? 'a point for every pick on the side that covers the spread set when the week opened. A push counts for nobody'
    : 'a point for every right pick';
  const from = lg.pick_format_from
    ? ` From the week of ${fmtFrom(lg.pick_format_from)}; earlier weeks scored ${PICK_FORMAT_LABEL[lg.pick_format_prev ?? 'regular']}.`
    : '';
  return `Pick'em scores ${PICK_FORMAT_LABEL[f]}: ${how}.${from}`;
}

/** "The Daily · Season · Total points" (+ " · N members" by the caller). */
function headerLine(league, crew) {
  const parts = [];
  if (league.games?.length) parts.push(league.games.map(gameLabel).join(' · '));
  if (league.format === 'guillotine') parts.push('Guillotine');
  if (SPAN_LABEL[league.span]) parts.push(SPAN_LABEL[league.span]);
  parts.push(crew ? 'Crew points' : SCORING_LABEL[league.scoring]);
  return parts.filter(Boolean).join(' · ');
}

function Move({ m }) {
  const mk = moveMark(m);
  if (!mk.dir) return null;
  return <span className={`lh-move lh-move--${mk.dir}`} data-move={mk.dir}>{mk.text}</span>;
}

function Chips({ items, current, href, label }) {
  if (!items?.length) return null;
  return (
    <nav className="lh-chips" aria-label={label}>
      {items.map((c) => (
        <Link key={c.key} href={href(c.key)} className={c.key === current ? 'lh-chip on' : 'lh-chip'}
          aria-current={c.key === current ? 'true' : undefined}>{c.label}</Link>
      ))}
    </nav>
  );
}

const joinedDay = (iso) => (iso ? dateLabel(iso, { weekday: false, tz: null }) : null);

export default function LeagueBoard({ league, table, uid, tab = 'standings', openInvite = false, now = new Date(), events = [] }) {
  const { standings, thisBucket, unit } = table;
  const unitWord = unit === 'week' ? 'week' : 'day';
  const crew = table.crew ?? null;
  const crewAll = crew?.game === 'all';
  const started = hasStarted(league, now);
  const kicker = !started
    ? `Starts ${startLabel({ startsAt: league.starts_at ? new Date(league.starts_at).toISOString() : null, startWeek: league.start_week }) ?? 'soon'}`
    : `${eyebrowDate(now)} · LIVE`;
  const hasTable = standings.buckets.length > 0;
  const isOwner = league.owner_id != null && Number(league.owner_id) === uid;
  const n = league.members.length;
  const offer = switchOffer(league, { now, isOwner });
  const view = { period: table.period, game: crew?.game };
  const meNow = thisBucket.rows.find((r) => r.userId === uid) ?? null;
  const nameOf = (id) => {
    if (id === uid) return 'You';
    const m = league.members.find((x) => Number(x.user_id) === Number(id));
    return m?.handle ? `@${m.handle}` : 'A member';
  };

  // THE TILES: the crew table's numbers on All games, the table's otherwise.
  const tiles = table.guillotine
    ? [
      { key: 'you', label: 'You', value: table.guillotine.chopped.some((c) => c.userId === uid) ? 'OUT' : 'IN' },
      { key: 'standing', label: 'Standing', value: String(table.guillotine.standing.length) },
      { key: 'now', label: tabLabel('today', unit), value: meNow ? fmtTile(meNow.current) : '—' },
    ]
    : crewAll
      ? statTiles({
        rows: crew.table.rows, uid, unit: 'week', hasTable: crew.table.weeks.length > 0,
        now: crew.week.points.has(uid) && crew.week.week ? crew.week.points.get(uid) : null, nowLabel: 'This week',
      })
      : statTiles({ rows: standings.rows, uid, unit, hasTable, now: meNow && meNow.games.length ? meNow.current : null });

  return (
    <div className="lv lv-league lh">
      <header className="lv-lhead">
        <div className="lv-lhead-top">
          <span className="lh-eyebrow" data-eyebrow>{kicker}</span>
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
        <p className="lv-sub" data-league-line>{headerLine(league, !!crew)} · {n} {n === 1 ? 'member' : 'members'}</p>
        <div className="lv-tiles">
          {tiles.map((t) => (
            <div className="lv-tile" key={t.key} data-tile={t.key}>
              <span className="lv-tile-k">{t.label}</span><span className="lv-tile-v">{t.value}</span>
            </div>
          ))}
        </div>
      </header>

      <nav className="lv-seg lv-tabs" aria-label="League sections">
        {LEAGUE_TABS.map((t) => (
          <Link key={t.key} href={leagueHref(league.id, t.key)} aria-current={tab === t.key ? 'page' : undefined}
            className={tab === t.key ? 'on' : ''} data-tab={t.key}>
            {tabLabel(t.key, crew ? 'week' : unit)}
          </Link>
        ))}
      </nav>

      {tab === 'standings' && crew && (
        <Chips label="Games" current={crew.game}
          items={[{ key: 'all', label: 'All games' }, ...crew.games.map((g) => ({ key: g, label: gameLabel(g) }))]}
          href={(g) => leagueHref(league.id, 'standings', { game: g })} />
      )}

      {tab === 'standings' && table.guillotine && (
        <section aria-label="Guillotine">
          <div className="lv-standing"><b>{table.guillotine.standing.length}</b><span className="lv-note">of {n} still standing</span></div>
          <p className="lv-kicker">Still standing{table.liveLabel ? ` · ${table.liveLabel}${table.liveFinal ? '' : ' so far'}` : ''}</p>
          {table.guillotine.standing.map((r) => (
            <div className={`lv-grow${r.userId === uid ? ' lv-trow--me' : ''}`} key={r.userId} data-standing={r.userId}>
              <span className="lv-trow-name">{who(r, uid)}</span>
              <span className={`lv-gtag${r.onBlock ? ' lv-gtag--block' : ''}`}>{r.onBlock ? 'On the block' : 'Safe so far'}</span>
              <span className="lv-trow-t">{fmtNum(r.current)}</span>
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

      {tab === 'standings' && crewAll && (
        <section aria-label="Crew standings" data-crew-table>
          <div className="lh-row lh-row--head lh-row--crew"><span>#</span><span>Player</span><span>Crew pts</span></div>
          {crew.table.rows.map((r) => (
            <div className={`lh-row lh-row--crew${r.userId === uid ? ' lh-row--me' : ''}`} key={r.userId} data-standing={r.userId}>
              <span className="lh-rank">{crew.table.weeks.length ? r.place : '–'}</span>
              <span className="lh-who">
                <span className="lh-name"><span className="lh-handle">{who(r, uid)}</span><Move m={r.move} /></span>
                <span className="lh-sub">{winsLine(r.wins, gameLabel) || (r.played ? `${r.played} game-week${r.played === 1 ? '' : 's'} played` : 'Nothing final yet')}</span>
              </span>
              <span className="lh-total">{fmtNum(r.total)}</span>
            </div>
          ))}
          <p className="lv-note lh-explain" data-crew-explainer>{CREW_EXPLAINER}</p>
          {crew.week.leaders.length > 0 && (
            <>
              <p className="lh-kicker">This week&rsquo;s leaders</p>
              {crew.week.leaders.map((l) => (
                <div className="lh-leader" key={l.game} data-leader={l.game}>
                  <span className="lv-note">{gameLabel(l.game)}</span>
                  <b>{l.userIds.map(nameOf).join(', ')} · {fmtNum(l.score)}</b>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {tab === 'standings' && !table.guillotine && !crewAll && (
        <>
          <Chips label="Period" items={table.chips} current={table.period}
            href={(p) => leagueHref(league.id, 'standings', { ...view, period: p })} />
          {hasTable ? (
            <section aria-label="Standings" data-standings>
              <div className="lh-row lh-row--head">
                <span>#</span><span>Player</span><span>{table.lastCol}</span><span>{league.span === 'season' ? 'Total' : 'Pts'}</span>
              </div>
              {standings.rows.map((r) => {
                const x = table.extras?.[r.userId] ?? { played: 0, best: null };
                const m = league.members.find((mm) => Number(mm.user_id) === r.userId);
                return (
                  <div className={`lh-row${r.userId === uid ? ' lh-row--me' : ''}`} key={r.userId} data-standing={r.userId}>
                    <span className="lh-rank">{r.place}</span>
                    <span className="lh-who">
                      <span className="lh-name"><span className="lh-handle">{who(r, uid)}</span><Move m={r.move} /></span>
                      <span className="lh-sub">{subLine({ played: x.played, best: x.best, unit, joined: joinedDay(m?.joined_at) })}</span>
                    </span>
                    <span className="lh-last">{fmtNum(r.current)}</span>
                    {/* POINTS, THEN THE RECORD (S2): a Pick'em league's W-L sits under its total. */}
                    <span className="lh-total">
                      {fmtNum(r.total)}
                      {r.record ? <span className="lv-trow-rec" data-record>{recordLine(r.record)}</span> : null}
                    </span>
                  </div>
                );
              })}
            </section>
          ) : (
            <p className="lv-empty">
              {!started ? `The table opens when the league starts - ${kicker.replace(/^Starts /, '')}.`
                : table.period === 'week' ? 'Nothing final this week yet.'
                : `The table fills when the first ${unitWord} is final.`}
            </p>
          )}
        </>
      )}

      {tab === 'standings' && (
        <section className="lh-feed" aria-label="Latest in the league" data-latest>
          <div className="lh-feed-head">
            <span className="lh-kicker">Latest in the league</span>
            <Link href={leagueHref(league.id, 'chat')}>Open chat &rarr;</Link>
          </div>
          {events.length ? events.map((e, i) => (
            <div className="lh-feed-row" key={`${e.kind}-${e.userId}-${i}`} data-event={e.kind}>
              <span className="lh-when">{dateLabel(e.at, { weekday: false, tz: null })}</span>
              <span>{eventLine(e, nameOf, gameLabel)}</span>
            </div>
          )) : <p className="lv-note">Nothing yet. Wins, joins and lead changes show up here.</p>}
        </section>
      )}

      {tab === 'today' && crewAll && (
        <section aria-label="This week" data-today>
          <p className="lv-kicker">This week so far · crew points if it ended now</p>
          {crew.table.rows.map((r) => ({ r, pts: crew.week.points.get(r.userId) ?? 0 }))
            .sort((a, b) => b.pts - a.pts)
            .map(({ r, pts }) => (
              <div className={`lv-trow lv-trow--week${r.userId === uid ? ' lv-trow--me' : ''}`} key={r.userId}>
                <span className="lv-trow-n">{pts ? '' : '–'}</span>
                <span className="lv-trow-who"><span className="lv-trow-name">{who(r, uid)}</span></span>
                <span className="lv-trow-t">{fmtNum(pts)}</span>
              </div>
            ))}
        </section>
      )}

      {tab === 'today' && !crewAll && (
        thisBucket.rows.some((r) => r.games.length) ? (
          <section aria-label={tabLabel('today', unit)} data-today>
            <p className="lv-kicker">{table.liveLabel}{table.liveFinal ? ' · final' : ' · so far'}</p>
            {thisBucket.rows.map((r) => (
              <div className={`lv-trow lv-trow--week${r.userId === uid ? ' lv-trow--me' : ''}`} key={r.userId}>
                <span className="lv-trow-n">{r.games.length ? r.place : '–'}</span>
                <span className="lv-trow-who">
                  <span className="lv-trow-name">{who(r, uid)}</span>
                  <span className="lv-note">{r.games.length ? r.games.map((g) => `${gameLabel(g.game)} ${fmtNum(g.score)}`).join(' · ') : 'Not in yet'}</span>
                </span>
                <span className="lv-trow-t">{fmtNum(r.current)}</span>
              </div>
            ))}
          </section>
        ) : (
          <p className="lv-empty">Nothing in yet {unit === 'week' ? 'this week' : 'today'}. Play, and your people will see it here.</p>
        )
      )}

      {tab === 'chat' && (
        <section className="lh-soon" aria-label="Chat" data-chat-soon>
          <p className="lh-kicker">Chat</p>
          <p className="lh-soon-big">Coming soon</p>
          <p className="lv-note">League chat is on its way: talk it over right here, with the day&rsquo;s results dropped in as they land.</p>
        </section>
      )}

      {tab === 'members' && (
        <section aria-label="Members" data-members>
          <div className="lh-invite">
            <span className="lh-invite-code">
              <span className="lh-invite-k">Invite code</span>
              <b data-invite-code={league.join_code}>{league.join_code}</b>
            </span>
            <ShareLinkButton name={league.name} token={league.invite_token} code={league.join_code} />
          </div>
          <p className="lh-kicker">{n} {n === 1 ? 'member' : 'members'} <span className="lv-note">of {league.max_members}</span></p>
          {league.members.map((m) => {
            const id = Number(m.user_id);
            const role = roleOf(league, league.members, id);
            const me = roleOf(league, league.members, uid);
            const items = menuFor({ actor: me, target: role, self: id === uid });
            const name = id === uid ? 'You' : m.handle ? `@${m.handle}` : 'A member';
            return (
              <div className="lh-member" key={id} data-member={id} data-role={role}>
                <span className="lh-avatar" aria-hidden="true">{(m.handle ?? (id === uid ? 'Y' : '?')).slice(0, 1).toUpperCase()}</span>
                <span className="lh-who">
                  <span className="lh-name">
                    <span className="lh-handle">{name}</span>
                    {ROLE_LABEL[role] && <span className={`lh-badge lh-badge--${role}`}>{ROLE_LABEL[role]}</span>}
                  </span>
                  <span className="lh-sub">{role === 'owner' ? 'Created the league' : 'Joined'} · {joinedDay(m.joined_at)}</span>
                </span>
                <MemberMenu leagueId={league.id} targetId={id} targetName={name} items={items} />
              </div>
            );
          })}
          <p className="lh-kicker">Notify me</p>
          <NotifyToggles leagueId={league.id} initial={league.notify} />
          <p className="lv-note">Saved now; each notification starts when it is switched on for everyone.</p>
          {!isOwner && <div className="lh-leave-row"><LeaveLeagueButton leagueId={league.id} name={league.name} /></div>}
        </section>
      )}

      {(tab === 'standings' || tab === 'today') && (
        <p className="lv-note lv-foot">
          {crewAll
            ? 'Only final weeks award crew points; this week so far is on the second tab.'
            : <>
              {league.scoring === 'rank'
                ? `Rank points: ${rankPointsCopy(unitWord, n)} No entry scores 0; ties share the higher place.`
                : `Total points: each ${unitWord}'s ${crew ? gameLabel(crew.game) : league.games?.length === 1 ? gameLabel(league.games[0]) : 'game'} score, added up. No entry scores 0.`}
              {league.drop_worst && league.span === 'season' ? ` Each player's worst ${unitWord} is dropped.` : ''}
              {' '}Only final results count; {unit === 'week' ? 'this week' : 'today'} so far is on the second tab.
            </>}
        </p>
      )}
      {tab === 'standings' && leaguePlaysPickem(league.games ?? []) && (
        <div className="lv-note lv-foot" data-pick-format-line={league.pick_format ?? 'regular'}>
          <p className="lv-note">{pickFormatLine(league)}</p>
          {pendingLine(league) && <PendingPickFormat leagueId={league.id} line={pendingLine(league)} canUndo={isOwner} />}
          {offer && (offer.options ?? [offer.to]).map((to, i) => <PickFormatSwitch key={to} leagueId={league.id} to={to} kind={offer.kind} showNote={i === 0 || offer.kind === 'switch'} />)}
        </div>
      )}
      {/* THE LEAGUE'S OWN PICK'EM BOARDS - the board filtered to these members
          (/pickem/<sport>?league=<id>), one per Pick'em sport. */}
      {tab === 'standings' && pickemBoardLinks(league.id, league.games).length > 0 && (
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
