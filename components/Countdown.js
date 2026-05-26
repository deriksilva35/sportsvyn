'use client';

/**
 * Sportsvyn vestaboard-style countdown.
 *
 * Displays days/hours/minutes/seconds to a target moment, with each digit
 * rendered as a split-flap tile that animates when its value changes. The
 * default target is 2026-06-11T16:00:00Z — kickoff of the 2026 FIFA World
 * Cup opener (≈ noon ET).
 *
 * Hydration safety: on first (server-rendered) paint we render dashes in
 * place of digits, then on mount we kick off setInterval and the tiles
 * receive real values. We re-mount the tile row across that transition (via
 * a `key` swap on the row container) so the first appearance of real digits
 * does NOT animate the flip — only subsequent ticks animate.
 *
 * All component CSS lives at the bottom of this file in a plain <style>
 * block so the component is portable.
 */

import { useEffect, useState } from 'react';

function calculateTimeLeft(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

function pad2(n) {
  return n.toString().padStart(2, '0').split('');
}

function FlipTile({ digit }) {
  const [displayDigit, setDisplayDigit] = useState(digit);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    if (digit === displayDigit) return;
    setIsFlipping(true);
    const t = setTimeout(() => {
      setDisplayDigit(digit);
      setIsFlipping(false);
    }, 360);
    return () => clearTimeout(t);
  }, [digit, displayDigit]);

  return (
    <div className="flip-tile">
      <div className={`flip-tile-top ${isFlipping ? 'flipping' : ''}`}>
        <div className="flip-tile-digit">{displayDigit}</div>
      </div>
      <div className={`flip-tile-bottom ${isFlipping ? 'flipping' : ''}`}>
        <div className="flip-tile-digit">
          {isFlipping ? digit : displayDigit}
        </div>
      </div>
    </div>
  );
}

function UnitGroup({ label, digits }) {
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-3">
      <div className="flex gap-1">
        <FlipTile digit={digits[0]} />
        <FlipTile digit={digits[1]} />
      </div>
      <span className="text-[10px] sm:text-xs font-mono text-muted tracking-widest uppercase">
        {label}
      </span>
    </div>
  );
}

function ColonSep() {
  return (
    <div className="flip-colon" aria-hidden="true">
      :
    </div>
  );
}

const DEFAULT_TARGET = '2026-06-11T16:00:00Z';

export default function Countdown({ targetDate = DEFAULT_TARGET }) {
  const targetMs = (typeof targetDate === 'string'
    ? new Date(targetDate)
    : targetDate
  ).getTime();

  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    setTimeLeft(calculateTimeLeft(targetMs));
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetMs));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  const phase = timeLeft === null ? 'placeholder' : 'live';
  const days = timeLeft ? pad2(timeLeft.days) : ['-', '-'];
  const hours = timeLeft ? pad2(timeLeft.hours) : ['-', '-'];
  const minutes = timeLeft ? pad2(timeLeft.minutes) : ['-', '-'];
  const seconds = timeLeft ? pad2(timeLeft.seconds) : ['-', '-'];

  return (
    <div className="flip-countdown">
      <div key={phase} className="flex items-start gap-1 sm:gap-2">
        <UnitGroup label="DAYS" digits={days} />
        <ColonSep />
        <UnitGroup label="HRS" digits={hours} />
        <ColonSep />
        <UnitGroup label="MIN" digits={minutes} />
        <ColonSep />
        <UnitGroup label="SEC" digits={seconds} />
      </div>

      <style>{`
        .flip-countdown {
          --tile-w: 32px;
          --tile-h: 48px;
          --tile-fs: 36px;
          --colon-w: 8px;
          --colon-fs: 24px;
        }
        @media (min-width: 640px) {
          .flip-countdown {
            --tile-w: 50px;
            --tile-h: 75px;
            --tile-fs: 55px;
            --colon-w: 12px;
            --colon-fs: 36px;
          }
        }
        .flip-tile {
          position: relative;
          width: var(--tile-w);
          height: var(--tile-h);
          background: #000;
          border: 1px solid var(--color-charcoal);
          border-radius: 3px;
          color: var(--color-paper-warm);
          font-family: var(--font-saira), sans-serif;
          font-weight: 900;
          font-style: italic;
          font-size: var(--tile-fs);
          line-height: var(--tile-h);
          text-align: center;
          overflow: hidden;
          perspective: 200px;
        }
        .flip-tile::before {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: var(--color-charcoal);
          z-index: 10;
          transform: translateY(-0.5px);
        }
        .flip-tile-top,
        .flip-tile-bottom {
          position: absolute;
          left: 0;
          right: 0;
          height: 50%;
          overflow: hidden;
          backface-visibility: hidden;
          transform: rotateX(0deg);
        }
        .flip-tile-top {
          top: 0;
          transform-origin: bottom;
        }
        .flip-tile-top.flipping {
          animation: flip-top 360ms ease-in forwards;
        }
        .flip-tile-bottom {
          top: 50%;
          transform-origin: top;
        }
        .flip-tile-bottom.flipping {
          animation: flip-bottom 360ms ease-out 30ms forwards;
        }
        .flip-tile-digit {
          position: absolute;
          left: 0;
          width: 100%;
          height: var(--tile-h);
          line-height: var(--tile-h);
          text-align: center;
        }
        .flip-tile-top .flip-tile-digit { top: 0; }
        .flip-tile-bottom .flip-tile-digit { bottom: 0; }
        @keyframes flip-top {
          0%   { transform: rotateX(0deg); }
          100% { transform: rotateX(-90deg); }
        }
        @keyframes flip-bottom {
          0%   { transform: rotateX(90deg); }
          100% { transform: rotateX(0deg); }
        }
        .flip-colon {
          display: flex;
          align-items: center;
          justify-content: center;
          height: var(--tile-h);
          width: var(--colon-w);
          font-family: var(--font-saira), sans-serif;
          font-weight: 900;
          font-style: italic;
          font-size: var(--colon-fs);
          color: var(--color-muted);
          line-height: 1;
          padding-bottom: 0.1em;
        }
      `}</style>
    </div>
  );
}
