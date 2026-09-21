// components/gridiron/PossessionDot.js - the volt dot, drawn once.
//
// THE MARK IS THE LIVE ACTIVITY'S (POSSESSION DOT ON THE BOARD relay). The
// card on the lock screen puts a volt dot after the abbreviation of the team
// with the ball; the Scores board and the game-page score strip now say it
// the same way, in the same mark, at the same size. Two surfaces drawing the
// same idea in two files is how "the same size" becomes two sizes, so both
// render THIS, and its size lives in one rule (.gi-poss, gridiron.css) that
// both pages already import.
//
// IT CARRIES THE WORDS IT REPLACED. Deleting "<TEAM> ball" from the situation
// line takes the fact off the page for anyone not looking at it - a bare
// decorative dot says nothing to a screen reader. The label is the sentence,
// so the dot is a mark for the eye and a sentence for everything else.

export default function PossessionDot({ abbr = null }) {
  return (
    <i className="gi-poss" role="img" aria-label={abbr ? `${abbr} has the ball` : 'has the ball'} />
  );
}
