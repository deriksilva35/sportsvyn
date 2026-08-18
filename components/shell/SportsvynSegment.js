// components/shell/SportsvynSegment.js - LIVE SCORES / FANTASY, in the shell.
//
// SERVER COMPONENT, RENDERED ONLY WHEN THE PAGE'S resolveShellMode SAYS SHELL.
// That gate lives at the CALL SITE ({isShell && <SportsvynSegment .../>}), not
// in here, because these pages already resolve shell mode for their viewport -
// a second resolution inside the component would be a second cookie read for
// an answer the page holds. The consequence the ruling asked for falls out:
// web HTML carries no segment markup at all, not a hidden one.
//
// WHY THE SHELL NEEDS THIS AND THE WEB DOES NOT: on the web these two pages
// are nav destinations (SCORES and NFL are both in lib/nav.js). In the
// container the pair shares ONE tab, and the tab lands on /scores - without a
// switch inside the surface, the movement board would be reachable only by
// knowing the URL, which is the exact defect the v0.2 chrome pass fixed for
// Your Drafts.

export default function SportsvynSegment({ active }) {
  return (
    <nav className="svseg" aria-label="Sportsvyn sections">
      <a href="/scores" className={active === 'scores' ? 'on' : ''}>Live Scores</a>
      <a href="/nfl/fantasy" className={active === 'fantasy' ? 'on' : ''}>Fantasy</a>
    </nav>
  );
}
