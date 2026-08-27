// components/today/ModeSwitch.js - the Today / My Sportsvyn switcher.
//
// TWO ROUTES, NOT A QUERY PARAM, and the reason is auth rather than taste.
// /my is force-dynamic, redirects to /signin with a callbackUrl, and carries
// robots:{index:false}. Folding it into `/` behind ?mode= would make the
// indexed front page conditionally noindex and conditionally auth-gated - an
// SEO hazard for no structural gain, a fortnight after we split the sitemap.
// Two <a>s keep both modes shareable and bookmarkable by construction.
//
// A CLIENT COMPONENT ONLY FOR usePathname. It renders links, not state: the lit
// pill is whichever route you are on, so a hard navigation and a client-side
// one cannot disagree about which mode is active.

'use client';

import { usePathname } from 'next/navigation';
// MODES and isActive live in lib/today/modes.js, JSX-free, so they can be
// tested without the test runner having to parse a component.
import { MODES, isActive } from '@/lib/today/modes';

export { MODES, isActive };

export default function ModeSwitch() {
  const pathname = usePathname();
  return (
    <nav className="modeswitch" aria-label="View">
      <div className="modewrap">
        {MODES.map((m) => {
          const on = isActive(m.href, pathname);
          return (
            <a key={m.href} href={m.href} className={`mode${on ? ' on' : ''}`}
               aria-current={on ? 'page' : undefined}>
              {m.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
