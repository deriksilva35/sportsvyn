'use client';

/**
 * FollowStar — labeled star toggle slotted next to the team H1.
 *
 * States (per locked mock):
 *   · unfollowed → paper-warm outline star + "Follow" label, charcoal
 *     border, ink background.
 *   · followed   → filled volt star + "Following" label, volt-dim
 *     border, faint volt-tint background.
 *
 * Logged-out behavior: the star never writes. A tap reveals an inline
 * graphite panel with a volt left-border and a real link to /signin.
 * The signin link forwards ?callbackUrl=<current path> so the magic-
 * link lands the user back on this team page after auth — same pattern
 * as SiteHeader's Sign In link.
 *
 * Optimistic UI: the star flips on click before the round trip resolves
 * (useTransition gates re-entrancy). The DB write is idempotent — see
 * app/actions/follows.js — so a double-tap can't corrupt state. If the
 * action returns { ok:false }, we revert the optimistic flip.
 *
 * Accessibility: button is the real semantic element (not the SVG),
 * aria-pressed mirrors the followed state, the visible label doubles
 * as the accessible name. 44px min touch target. Focus ring is volt.
 */

import { useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { followTeam, unfollowTeam } from '@/app/actions/follows';

function StarIcon({ filled }) {
  // The "filled" variant uses fill + stroke both at currentColor; the
  // outline variant has fill="none". currentColor lets the button's
  // CSS color drive the visual state without prop-drilling color.
  return (
    <svg
      className="follow-star-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2.5l2.9 6.45 7.05.72-5.25 4.78 1.5 6.95L12 17.95 5.8 21.4l1.5-6.95L2.05 9.67l7.05-.72L12 2.5z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FollowStar({ teamId, teamName, isAuthed, initialFollowing }) {
  const [following, setFollowing] = useState(Boolean(initialFollowing));
  const [promptOpen, setPromptOpen] = useState(false);
  const [, startTransition] = useTransition();
  const pathname = usePathname();

  // Same shape as SiteHeader's signinHref — preserve where the user
  // is so they come back here after the magic-link click.
  const signinHref =
    pathname && !pathname.startsWith('/signin')
      ? `/signin?callbackUrl=${encodeURIComponent(pathname)}`
      : '/signin';

  function onClick() {
    if (!isAuthed) {
      setPromptOpen(true);
      return;
    }
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      const result = next ? await followTeam(teamId) : await unfollowTeam(teamId);
      if (!result?.ok) {
        // Revert the optimistic flip. Includes the unauthenticated
        // branch — although isAuthed should already gate that path,
        // the server is the source of truth.
        setFollowing(!next);
      }
    });
  }

  return (
    <div className="follow-star-wrap">
      <button
        type="button"
        className={`follow-star-btn${following ? ' is-following' : ''}`}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${teamName}` : `Follow ${teamName}`}
        onClick={onClick}
      >
        <StarIcon filled={following} />
        <span className="follow-star-label">{following ? 'Following' : 'Follow'}</span>
      </button>

      {promptOpen && !isAuthed && (
        <div className="follow-star-prompt" role="status">
          <p className="follow-star-prompt-msg">
            Sign in to follow {teamName} and track them across Sportsvyn.
          </p>
          <a href={signinHref} className="follow-star-prompt-cta">
            Sign in <span aria-hidden="true">→</span>
          </a>
          <button
            type="button"
            className="follow-star-prompt-dismiss"
            aria-label="Dismiss"
            onClick={() => setPromptOpen(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
