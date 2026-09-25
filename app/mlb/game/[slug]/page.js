// app/mlb/game/[slug] - the MLB game page, built to
// docs/design/mocks/mlb-scores-v0_1.html (the second frame).
//
// IT IS NOT THE GRIDIRON PAGE WITH BASEBALL WORDS. That page is a drive strip,
// a field, a drive chart and player lines shaped like passing and rushing;
// none of it means anything here. The mock's four blocks are what a baseball
// reader wants and all this draws: the line score with R/H/E and the current
// half in volt, an At Bat module, the scoring plays with the score after each,
// and the box score under Hitting / Pitching tabs.
//
// EVERY BLOCK IS CONDITIONAL ON ITS OWN DATA, the same law the gridiron page
// follows: a game with no box rows grows no box section rather than a heading
// over an empty table.
//
// NO CLOCK ANYWHERE, which the mock says twice and is the one thing a football
// page would get wrong by reflex. The scores feed sends clock 0 and "0:00" on
// every MLB row - scheduled, live and final alike.
//
// THE TABS ARE LINKS, not client state. The Scores tab's day strip and pills
// are links for the same reason: this page is already force-dynamic, a
// searchParam tab costs no client boundary, and the resulting URL is one a
// reader can send to somebody.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import TeamMark from '@/components/team/TeamMark';
import { pairHasHeadgear } from '@/lib/teams/headgear';
import StandaloneTime from '@/components/StandaloneTime';
import { getMlbGame, getMlbPlays } from '@/lib/mlb/gameDetail';
import { outsToInnings } from '@/lib/mlb/playsImport';
import { stripCells } from '@/lib/mlb/strip';
import { decisions, pitcherLine, shortName } from '@/lib/mlb/cardLines';
import FollowStar from '@/components/team/FollowStar';
import AlertBell from '@/components/alerts/AlertBell';
import { auth } from '@/auth';
import { getFollowedTeamIds } from '@/lib/follows';
import { resolveShellMode } from '@/lib/shell/shell';
import { stateFromMatch, gameUrlFor } from '@/lib/push/liveActivityState';
import '@/components/gridiron/gridiron.css';
import './mlbgame.css';

export const dynamic = 'force-dynamic';

const TABS = [['hitting', 'Hitting'], ['pitching', 'Pitching'], ['plays', 'Plays']];

function TeamRow({ t, score, show, batting, signedIn = false, isShell = false, following = null, headgear = true }) {
  // THE STAR IS SIGNED-IN ONLY, and needs an id - the same two conditions
  // GameTeamRow applies on the football pages, for the same reasons: a game
  // header is not the place to offer a stranger an unfollowable follow, and a
  // star wired to null would write nothing and say nothing about why.
  const canFollow = signedIn && t?.id != null;
  return (
    <div className="mg-team">
      <TeamMark primary={t?.colors?.primary} secondary={t?.colors?.secondary}
        abbr={t?.abbreviation} size={26} title={t?.name} leagueSlug="mlb" headgear={headgear} />
      <span className="ab">{t?.abbreviation ?? ''}</span>
      <span className="nm">{t?.shortName ?? t?.name ?? 'TBD'}</span>
      {/* THE BATTING MARK IS THE POSSESSION DOT'S SIBLING, and deliberately the
          same mark: this product already says "this side has it" with a volt
          dot, and baseball's version of that is who is at the plate. */}
      {batting ? <i className="gi-poss" role="img" aria-label={`${t?.abbreviation ?? ''} batting`} /> : null}
      {canFollow ? (
        <span className="mg-follow">
          <FollowStar
            teamId={t.id}
            teamName={t.name ?? t.abbreviation ?? 'this team'}
            isAuthed
            initialFollowing={following === true}
            isShell={isShell}
          />
        </span>
      ) : null}
      <b className="sc">{show ? (score ?? 0) : ''}</b>
    </div>
  );
}

/** The mock's big diamond. Same contract as the card's: ABSENT, not empty. */
function Diamond({ bases }) {
  if (!bases) return null;
  const sq = (on, cls) => <i className={`d-b ${cls}${on ? ' on' : ''}`} />;
  return (
    <span className="mg-dia" role="img"
      aria-label={[bases.first && '1st', bases.second && '2nd', bases.third && '3rd']
        .filter(Boolean).join(', ') || 'bases empty'}>
      {sq(bases.second, 'b2')}{sq(bases.third, 'b3')}{sq(bases.first, 'b1')}
    </span>
  );
}

export default async function MlbGamePage({ params, searchParams }) {
  const { slug } = await params;
  const q = await searchParams;
  const tab = TABS.some(([k]) => k === q?.box) ? q.box : 'hitting';
  const g = await getMlbGame(slug).catch(() => null);
  if (!g) notFound();
  // FOR THE BELL AND THE TWO STARS ONLY. The page itself is open to everyone;
  // this decides whether the sheet shows toggles or a sign-in, and whether a
  // star is drawn at all. One follow read for both sides, empty when signed
  // out, and caught - a follow lookup must never cost a game page.
  const viewerId = (await auth().catch(() => null))?.user?.id ?? null;
  const [followedIds, isShell] = await Promise.all([
    viewerId == null ? Promise.resolve([]) : getFollowedTeamIds(viewerId).catch(() => []),
    resolveShellMode().catch(() => false),
  ]);
  const followed = new Set(followedIds);
  const live = g.status === 'live';
  const final = g.status === 'final';
  const show = live || final;
  const half = String(g.liveState?.half ?? '');
  const batting = live ? (half === 'Top' ? 'away' : half === 'Bottom' ? 'home' : null) : null;
  // BOTH OR NEITHER (lib/teams/headgear.js).
  const headgear = pairHasHeadgear('mlb', g.away?.abbreviation, g.home?.abbreviation);
  const cells = live ? stripCells(g.liveState) : null;
  const { hitters, pitchers } = g.box;
  const rows = tab === 'pitching' ? pitchers : hitters;
  // READ ONLY WHEN THE TAB IS OPEN. A nine-inning game is 500+ play rows and
  // the other two tabs need none of them - see getMlbPlays().
  const halves = tab === 'plays'
    ? await getMlbPlays(g.id, [...hitters, ...pitchers]).catch(() => [])
    : null;
  const byTeam = (list, id) => list.filter((r) => r.team_id === id);
  // THE DECISION IS READ FROM THE BOX, which is the only place it exists - the
  // provider marks the W on the pitcher's line and nowhere on the game row.
  const dec = final ? decisions([...hitters, ...pitchers]) : null;
  // WHICH COLUMN IS NOW. The mock puts the current inning in volt: the header
  // cell always, and the cell of the side actually batting - the other side's
  // cell for that inning has not been played and a volt blank would claim it
  // had. Null whenever the game is not live, so a final has no "now".
  const nowInning = live ? (Number(g.liveState?.period) || null) : null;
  const isNow = (side, i) => nowInning != null && i + 1 === nowInning
    && (batting == null || batting === side);

  return (
    <div className="gi mgame" data-surface="ink">
      <GlobalHeaderServer activeNav="scores" />
      <div className="mg-wrap">
        {/* TWO WAYS OUT, and the second one is the reason the bracket is not a
            page nobody can reach - the dead "MLB 2027" chip is what that rule
            is named after. It renders in October and in April alike; a bracket
            with no field set says so rather than 404ing. */}
        <div className="mg-crumb">
          <Link href="/scores?sport=mlb">&#8249; Scores · MLB</Link>
          <Link className="r" href="/mlb/bracket">Postseason bracket &#8250;</Link>
        </div>

        <header className="mg-head">
          <div className="mg-chips">
            {live ? <span className="mg-chip live">LIVE</span> : null}
            {g.chip ? <span className="mg-qc">{g.chip}</span> : null}
            {!show && g.kickoffAt ? <span className="mg-chip time"><StandaloneTime iso={g.kickoffAt} /></span> : null}
            {g.seasonPhase === 'POST' ? <span className="mg-chip post">POSTSEASON</span> : null}
          </div>
          {/* AWAY FIRST. Baseball reads "Away at Home" like every American
              sport, which lib/gridiron/teamOrder.js already defaults to. */}
          <TeamRow t={g.away} score={g.awayScore} show={show} batting={batting === 'away'} headgear={headgear}
            signedIn={viewerId != null} isShell={isShell} following={followed.has(g.away?.id)} />
          <TeamRow t={g.home} score={g.homeScore} show={show} batting={batting === 'home'} headgear={headgear}
            signedIn={viewerId != null} isShell={isShell} following={followed.has(g.home?.id)} />
          <div className="mg-foot">
            <span>MLB · {g.seasonYear}</span>
            {g.venue ? <span className="r">{g.venue}</span> : null}
          </div>
          {/* THE BELL IS THE FOOTBALL PAGES' BELL, not a baseball copy of one.
              It carries the five triggers, the close row IN THIS SPORT'S WORDS
              (rowsForSport, off the leagueSlug below), and the lock-screen
              switch row - and the six Activity fields are built HERE, on the
              server, by the same stateFromMatch()/gameUrlFor() pair the push
              script uses, so the card on the lock screen and the page cannot
              disagree about the score.
              THE LINE IS NOT PASSED: stateFromMatch falls back to
              baseballLine(game), which reads the batting side, the situation
              and the newest scoring play off the very object this page is
              already drawing. */}
          <div className="mg-bell">
            <AlertBell compact={false} signedIn={viewerId != null} match={{
              id: g.id, slug: g.slug, leagueSlug: g.leagueSlug,
              homeAbbr: g.home?.abbreviation ?? '', awayAbbr: g.away?.abbreviation ?? '',
              homeTeamId: g.home?.id ?? null, homeSlug: g.home?.slug ?? null,
              kickoffAt: g.kickoffAt,
            }} liveActivity={{
              url: gameUrlFor(g),
              state: stateFromMatch(g),
              final,
            }} />
          </div>
        </header>

        {g.lineScore ? (
          <section className="mg-sect">
            <div className="mg-kick"><h2>LINE SCORE</h2><div className="rule" /></div>
            <div className="mg-lsw">
              <table className="mg-ls">
                <thead>
                  <tr>
                    <th className="t" scope="col"><span className="mg-sr">Team</span></th>
                    {g.lineScore.columns.map((c) => (
                      <th key={c} scope="col" className={nowInning === c ? 'now' : undefined}>{c}</th>
                    ))}
                    <th className="tot r" scope="col">R</th><th className="tot" scope="col">H</th><th className="tot" scope="col">E</th>
                  </tr>
                </thead>
                <tbody>
                  {[['away', g.away, g.lineScore.away], ['home', g.home, g.lineScore.home]].map(([k, team, row]) => (
                    <tr key={k}>
                      <th className="t" scope="row">{team?.abbreviation ?? ''}</th>
                      {/* A BLANK CELL, NOT A ZERO, where a side did not bat -
                          a home team that led after the top of the ninth
                          played eight, and a 0 there invents an inning. */}
                      {row.innings.map((v, i) => (
                        <td key={g.lineScore.columns[i]} className={isNow(k, i) ? 'now' : undefined}>{v == null ? '' : v}</td>
                      ))}
                      <td className="tot r">{row.runs ?? ''}</td>
                      <td className="tot">{row.hits ?? ''}</td>
                      <td className="tot">{row.errors ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* THE AT BAT MODULE, and it is THREE modules wearing one frame: the
            probables before first pitch, the count and the diamond while the
            game is on, the decision once it is over. The mock says so in its
            own caption, and they are one block because they answer one
            question - what is the state of this game right now.

            PRE-GAME IT NEEDS THE STATSAPI SEAM. With MLB_STATSAPI off the
            probables are unknown and the block does not render, which is
            correct rather than degraded: we do not know them. */}
        {live && cells ? (
          <section className="mg-mod">
            <div className="mg-eb">AT BAT</div>
            <div className="mg-sit">
              <div className="big">{cells.lead}{cells.sub ? <small>{cells.sub}</small> : null}</div>
              <Diamond bases={g.liveState?.bases ?? null} />
              <div className="big cnt">{cells.count ?? ''}{cells.count ? <small>count</small> : null}</div>
            </div>
            {(g.liveState?.batter || g.liveState?.pitcher) ? (
              <p className="mg-abline">
                {g.liveState.batter ? <><b>{g.liveState.batter}</b> batting</> : null}
                {g.liveState.batter && g.liveState.pitcher ? ' · ' : null}
                {g.liveState.pitcher ? <><b>{g.liveState.pitcher}</b> pitching</> : null}
              </p>
            ) : null}
          </section>
        ) : !show && g.probables ? (
          <section className="mg-mod">
            <div className="mg-eb">PROBABLES</div>
            <div className="mg-prob">
              <span>{g.away?.abbreviation} <b>{shortName(g.probables.away?.name) ?? 'TBA'}</b></span>
              <span>{g.home?.abbreviation} <b>{shortName(g.probables.home?.name) ?? 'TBA'}</b></span>
            </div>
          </section>
        ) : final && (dec.win || dec.loss || dec.save) ? (
          <section className="mg-mod">
            <div className="mg-eb">DECISION</div>
            <div className="mg-dec">
              {dec.win ? <span><em>W</em> {pitcherLine(dec.win)}</span> : null}
              {dec.loss ? <span><em>L</em> {pitcherLine(dec.loss)}</span> : null}
              {/* MOST GAMES HAVE NO SAVE, and the row is absent rather than
                  dashed - "SV —" reads as a fetch that failed. */}
              {dec.save ? <span><em>SV</em> {pitcherLine(dec.save)}</span> : null}
            </div>
          </section>
        ) : null}

        {g.scoringPlays.length ? (
          <section className="mg-sect">
            <div className="mg-kick"><h2>SCORING</h2><div className="rule" /></div>
            {/* OLDEST FIRST, the mock's own order (Bot 4th, Top 5th, Top 7th),
                and the score BEFORE the sentence. The list is how the game got
                to the number at the top of the page, and a game read backwards
                shows a 3-2 above a 0-2 and reads as a correction. */}
            {g.scoringPlays.map((p, i) => (
              <div className="mg-play" key={`${p.inning}-${i}`}>
                <span className="wh">{p.half === 'top' ? 'Top' : 'Bot'} {p.inning}</span>
                <span className="sc">{p.awayScore}-{p.homeScore}</span>
                <span className="tx">{p.text}</span>
              </div>
            ))}
          </section>
        ) : null}

        {hitters.length || pitchers.length ? (
          <section className="mg-sect">
            <div className="mg-kick"><h2>BOX SCORE</h2><div className="rule" /></div>
            <div className="mg-tabs" role="tablist">
              {TABS.map(([k, label]) => (
                <Link key={k} href={`/mlb/game/${g.slug}?box=${k}`}
                  className={tab === k ? 'on' : undefined}
                  aria-current={tab === k ? 'page' : undefined}>{label}</Link>
              ))}
            </div>
            {tab === 'plays' ? (
              halves?.length ? halves.map((h) => (
                <div className="mg-half" key={h.key}>
                  {/* NEWEST HALF FIRST - a reader opening this during a live
                      game is looking for what just happened, and nine innings
                      of scrolling to reach it is the reason a box score has
                      tabs at all. */}
                  <h3 className="mg-hlf">{h.label}</h3>
                  {h.atBats.map((ab) => (
                    <div className={`mg-ab${ab.scoring ? ' scored' : ''}${ab.aside ? ' aside' : ''}`}
                      key={ab.key} data-ab={ab.batterId ?? 'event'}>
                      <p className="mg-abr">
                        {ab.batter ? <span className="who">{ab.batter}</span> : null}
                        {/* THE RESULT IN BOLD, and the score AFTER it only on a
                            play that scored: every row carries a scoreline and
                            printing it beside a groundout would say nothing. */}
                        <b>{ab.result ?? 'At bat'}</b>
                        {ab.scoring && ab.score
                          ? <span className="sc">{ab.score.away}-{ab.score.home}</span> : null}
                      </p>
                      {ab.pitches.length ? (
                        <ol className="mg-pits">
                          {ab.pitches.map((p) => (
                            <li key={p.key}><i>{p.n}:</i> {p.line}</li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  ))}
                </div>
              )) : <p className="mg-empty">No pitches on this game yet.</p>
            ) : [g.away, g.home].map((team) => {
              const mine = byTeam(rows, team?.id);
              if (!mine.length) return null;
              return (
                <div className="mg-box" key={team?.id ?? 'x'}>
                  <h3>{team?.shortName ?? team?.name}</h3>
                  {tab === 'pitching' ? (
                    <table className="mg-bt">
                      <thead><tr><th className="n">Pitching</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th></tr></thead>
                      <tbody>
                        {mine.map((r) => (
                          <tr key={r.bdl_player_id}>
                            <td className="n">{r.player_name}</td>
                            {/* OUTS BACK TO INNINGS AT THE VERY LAST MOMENT.
                                The column stores outs because 6.2 does not
                                add; a column of aligned thirds is the one
                                place "6.2" is the right rendering. */}
                            <td>{outsToInnings(r.outs_recorded) ?? ''}</td>
                            <td>{r.hits_allowed ?? ''}</td><td>{r.runs_allowed ?? ''}</td>
                            <td>{r.earned_runs ?? ''}</td><td>{r.walks_allowed ?? ''}</td>
                            <td>{r.strikeouts_pitched ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="mg-bt">
                      <thead><tr><th className="n">Batting</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th></tr></thead>
                      <tbody>
                        {mine.map((r) => (
                          <tr key={r.bdl_player_id}>
                            <td className="n">{r.player_name}{r.position ? <small> {r.position}</small> : null}</td>
                            <td>{r.at_bats ?? ''}</td><td>{r.runs ?? ''}</td><td>{r.hits ?? ''}</td>
                            <td>{r.rbi ?? ''}</td><td>{r.walks ?? ''}</td><td>{r.strikeouts ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </section>
        ) : null}
      </div>
    </div>
  );
}
