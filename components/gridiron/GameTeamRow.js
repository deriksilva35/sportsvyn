// components/gridiron/GameTeamRow.js - the team row in a game page header,
// for both codes.
//
// THE THIRD CALLER ARRIVED. The NFL and CFB pages each carried their own copy
// of this row, and the CFB copy said why: "they are markup, the sibling law
// says siblings own their markup... If a third gridiron surface ever wants
// them, that is the moment to extract - three callers is a component, two is
// a coincidence." Adding a follow star is that third want, and putting it in
// two places would have been the second copy of the thing this relay exists
// to stop copying.
//
// THE TWO ROWS WERE THE SAME ROW. Diffed before the extract: identical but
// for RankBadge, which the NFL page has no poll to fill. The badge renders
// null on a null rank, so one component covers both without a league branch -
// the NFL caller simply passes no rank.
//
// ORDER IS LAYOUT HERE, so it is written once and not rearranged casually:
// badge, helmet, abbreviation, name, record, follow star, then the score
// pushed to the right edge by margin-left:auto. Every part but the name is
// flex:none; the name is the only child that gives way.

import TeamMark from '@/components/team/TeamMark';
import RankBadge from '@/components/gridiron/RankBadge';
import FollowStar from '@/components/team/FollowStar';
import PossessionDot from '@/components/gridiron/PossessionDot';

export default function GameTeamRow({
  t, score, loser, show, rank = null, record = null,
  signedIn = false, isShell = false, following = null, hasBall = false,
  leagueSlug = null, headgear = true,
}) {
  // THE STAR IS SIGNED-IN ONLY HERE, and that is a deliberate difference from
  // the team page. On /team/[slug] the star is the page's own call to action
  // and a signed-out tap opens a prompt that explains itself. In a game
  // header it would be one more control on a row that already carries a rank,
  // a team mark, a record and a score, offering an unfollowable follow to a
  // reader who cannot use it. A stranger gets the row exactly as it was.
  //
  // It also needs an id. A row whose team failed to join has none, and a star
  // wired to null would write nothing and say nothing about why.
  const canFollow = signedIn && t?.id != null;
  return (
    <div className={`gg-teamrow${loser ? ' loser' : ''}`}>
      <RankBadge rank={rank} size="big" />
      {/* the mark before the abbreviation, facing the score: headgear where
          the league has it and the page says both sides do, else the disc */}
      <TeamMark primary={t?.colors?.primary} secondary={t?.colors?.secondary} abbr={t?.abbreviation ?? null} size={40}
        title={t?.name ?? undefined} className="gg-hm" leagueSlug={leagueSlug} headgear={headgear} />
      {/* THE VOLT DOT SITS WITH THE ABBREVIATION, which is what the Live
          Activity's card marks and what the strip's own sentence used to
          name. Inside the span, so it travels with the three letters rather
          than becoming a seventh child of a row whose child count has already
          broken this layout once. */}
      <span className="abbr">{t?.abbreviation ?? ''}{hasBall ? <PossessionDot abbr={t?.abbreviation ?? null} /> : null}</span>
      <span className="tname">{t?.name ?? 'TBD'}</span>
      {/* A chip may only claim knowledge. Records carry no kickoff, so this
          renders pre-game, live and final alike - unlike the market strip. */}
      {record ? <span className="gg-rec">{record}</span> : null}
      {canFollow ? (
        <span className="gg-follow">
          <FollowStar
            teamId={t.id}
            teamName={t.name ?? t.abbreviation ?? 'this team'}
            isAuthed
            initialFollowing={following === true}
            isShell={isShell}
          />
        </span>
      ) : null}
      {/* No score column before kickoff. A 0 next to a team that has not played
          is not a low score, it is a wrong one. */}
      <span className="score">{show ? score : ''}</span>
    </div>
  );
}
