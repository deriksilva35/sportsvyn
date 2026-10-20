'use client';

// The Nightly room's one clock: a pill in the header ("0:24"), red under 0:05.
// Shown only on the reader's own turn. The room itself re-reads at zero.
import useSecondsLeft from './useSecondsLeft';
import { clockText, clockLow } from '@/lib/draftGame/nightlyCopy';
import './nightly.css';

export default function NightlyClock({ deadline, yourTurn }) {
  const left = useSecondsLeft(yourTurn ? deadline : null);
  if (!yourTurn || left == null) return null;
  return (
    <span className={`nd-clock n${clockLow(left) ? ' nd-clock--low' : ''}`} aria-live="off" data-nightly-clock>{clockText(left)}</span>
  );
}
