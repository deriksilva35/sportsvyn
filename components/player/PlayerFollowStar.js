'use client';

/**
 * PlayerFollowStar — labeled star toggle next to the player H1. Exact
 * rename-mirror of components/team/FollowStar.js (playerId/playerName props,
 * followPlayer/unfollowPlayer actions). Same optimistic flip + revert via
 * useTransition, same logged-out inline sign-in prompt (callbackUrl to the
 * current path), same aria-pressed + 44px target. Shares .follow-star-* styling
 * via components/follow-star.css.
 */

import { useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { followPlayer, unfollowPlayer } from '@/app/actions/follows';
import '@/components/follow-star.css';

function StarIcon({ filled }) {
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

export default function PlayerFollowStar({ playerId, playerName, isAuthed, initialFollowing }) {
  const [following, setFollowing] = useState(Boolean(initialFollowing));
  const [promptOpen, setPromptOpen] = useState(false);
  const [, startTransition] = useTransition();
  const pathname = usePathname();

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
      const result = next ? await followPlayer(playerId) : await unfollowPlayer(playerId);
      if (!result?.ok) setFollowing(!next); // revert on failure; server is truth
    });
  }

  return (
    <div className="follow-star-wrap">
      <button
        type="button"
        className={`follow-star-btn${following ? ' is-following' : ''}`}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${playerName}` : `Follow ${playerName}`}
        onClick={onClick}
      >
        <StarIcon filled={following} />
        <span className="follow-star-label">{following ? 'Following' : 'Follow'}</span>
      </button>

      {promptOpen && !isAuthed && (
        <div className="follow-star-prompt" role="status">
          <p className="follow-star-prompt-msg">
            Sign in to follow {playerName} and track them across Sportsvyn.
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
