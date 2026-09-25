// app/mlb/bracket - the twelve, and the eleven series between them.
//
// FOUR COLUMNS, NOT A TREE. A single-elimination tree draws lines between
// slots because the only thing a slot carries is a name; a baseball bracket's
// slots each carry a SERIES - a record, a game number, who is at home tonight -
// and those need width. So this is four labelled columns of series cards,
// which is also what a phone can draw without a horizontal scrollbar.
//
// NO WORLD CUP HELPERS, by ruling and for cause - lib/mlb/bracket.js says why.
//
// EVERY SLOT IS HONEST ABOUT WHAT IT KNOWS. A slot with a series shows the
// record; a slot with two seeds and no games shows the matchup; a slot still
// waiting on an earlier result names where its club will come from ("Winner
// 4/5"); a slot that knows nothing at all says TBD and the day it is set.

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import TeamMark from '@/components/team/TeamMark';
import { pairHasHeadgear } from '@/lib/teams/headgear';
import { getBracket, LEAGUES, LEAGUE_LABEL, TBD } from '@/lib/mlb/bracket';
import { STAGES, STAGE_LABEL } from '@/lib/mlb/postseason';
import './bracket.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'MLB Postseason Bracket · Sportsvyn',
  description: 'The twelve teams, the eleven series, and who is through.',
};

/** One club's row inside a slot. */
function Side({ t, live, headgear = true }) {
  // THE PLACEHOLDER IS A SENTENCE, NOT A BLANK. "Winner 4/5" is true; an empty
  // row is just a gap the reader has to interpret.
  if (!t.teamId) {
    return (
      <div className="bk-side quiet">
        <span className="bk-seed">{t.seed ?? ''}</span>
        <span className="bk-nm">{t.placeholder ?? TBD}</span>
      </div>
    );
  }
  return (
    <div className={`bk-side${t.winner ? ' won' : ''}`}>
      <span className="bk-seed">{t.seed ?? ''}</span>
      <TeamMark primary={t.colors?.primary} secondary={t.colors?.secondary} abbr={t.abbreviation} size={20} title={t.name}
        leagueSlug="mlb" headgear={headgear} />
      <span className="bk-ab">{t.abbreviation}</span>
      <span className="bk-nm">{t.name}</span>
      {t.bye ? <span className="bk-bye">bye</span> : null}
      {/* WINS, NOT A SCORE. A series is 3-1; the games inside it have scores
          and they are on the game pages, which each row links to below. */}
      <b className={`bk-w${live ? ' live' : ''}`}>{t.wins ?? ''}</b>
    </div>
  );
}

function Slot({ s }) {
  const live = s.status === 'live';
  const next = live && s.nextGame ? `Game ${s.nextGame} next` : null;
  return (
    <div className={`bk-slot ${s.status}`} data-stage={s.stage} data-status={s.status}>
      <div className="bk-top">
        <span className="bk-bo">Best of {s.bestOf}</span>
        {live ? <span className="bk-live">LIVE</span>
          : s.status === 'final' ? <span className="bk-rec">{s.record}</span>
            : s.status === 'scheduled' ? <span className="bk-rec quiet">0-0</span> : null}
      </div>
      {/* BOTH OR NEITHER: a slot with one cutout and one disc reads as a
          favourite, and a slot still waiting on a winner has one of each. */}
      {s.teams.map((t, i) => <Side key={t.teamId ?? `p${i}`} t={t} live={live}
        headgear={s.teams.length === 2 && pairHasHeadgear('mlb', s.teams[0]?.abbreviation, s.teams[1]?.abbreviation)} />)}
      {next ? <div className="bk-foot">{next}</div> : null}
      {/* THE GAMES ARE LINKS, because the series card is the index of them and
          a reader who wants the box score should not have to find /scores. */}
      {s.games.length ? (
        <div className="bk-games">
          {s.games.map((g, i) => (
            <Link key={g.id} href={`/mlb/game/${g.slug}`}
              className={`bk-g${g.status === 'live' ? ' live' : ''}`}>
              {i + 1}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default async function MlbBracketPage({ searchParams }) {
  const q = await searchParams;
  const asked = Number(q?.season);
  const season = Number.isInteger(asked) && asked > 2000 ? asked : new Date().getUTCFullYear();
  const b = await getBracket(season).catch(() => null);

  return (
    <div className="gi bkpage" data-surface="ink">
      <GlobalHeaderServer activeNav="scores" />
      <div className="bk-wrap">
        <div className="bk-crumb"><Link href="/scores?sport=mlb">&#8249; Scores · MLB</Link></div>
        <header className="bk-head">
          <h1>Postseason</h1>
          <div className="bk-sub">
            {season}
            {/* SEEDS ARE PROVISIONAL UNTIL SOMEBODY STOPS PLAYING FOR THEM.
                Twelve seeds in September is a standings snapshot that will
                move again on Tuesday night; "the twelve are set" said of it
                is a claim about a field nobody has qualified for. It is only
                true once postseason games exist, which is what `set` means. */}
            {b?.champion
              ? <> · <b>{b.champion.name}</b> win the World Series</>
              : b?.liveCount
                ? <> · <span className="hot">{b.liveCount} series live</span></>
                : b?.seeded === 12
                  ? (b.set ? ' · the twelve are set' : ' · if the season ended today')
                  : ' · the field is not set yet'}
          </div>
        </header>

        {!b ? (
          <p className="bk-empty">The bracket could not be read.</p>
        ) : STAGES.map((stage) => (
          <section className="bk-col" key={stage} data-column={stage}>
            <div className="bk-kick"><h2>{STAGE_LABEL[stage]}</h2><div className="rule" /></div>
            {/* THE LEAGUES ARE NAMED IN THE FIRST THREE ROUNDS AND NOT IN THE
                LAST, because the World Series is the one series that is not
                either league's. */}
            {stage === 'world_series'
              ? b.columns[stage].map((s) => <Slot key={s.id} s={s} />)
              : LEAGUES.map((lg) => (
                <div className="bk-league" key={lg}>
                  <h3>{LEAGUE_LABEL[lg]}</h3>
                  <div className="bk-slots">
                    {b.columns[stage].filter((s) => s.league === lg)
                      .map((s) => <Slot key={s.id} s={s} />)}
                  </div>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
