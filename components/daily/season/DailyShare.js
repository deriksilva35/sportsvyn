'use client';

/**
 * components/daily/season/DailyShare.js - the Daily's share button: an IMAGE
 * card (app/daily/board/[date]/card, 1080x1680) plus three lines of text.
 *
 * THE PLATFORM SHARE, WITH THE FILE. navigator.share({ files, text }) where
 * navigator.canShare says files are allowed (iOS Safari, Android Chrome);
 * text-only navigator.share where files are not; and where there is no share
 * sheet at all (desktop) the image is downloaded and the text copied, so the
 * tap never does nothing.
 *
 * THE IMAGE IS FETCHED BEFORE THE TAP. Safari ties navigator.share to the
 * tap's user activation, and a share that first awaits a network fetch can
 * lose it and be refused. So the card is fetched once on mount and held as a
 * File; a tap that beats the fetch still fetches, and falls back to text if
 * the sheet then refuses.
 */

import { useEffect, useRef, useState } from 'react';
import { cardFileName } from '@/lib/daily/shareCard';

async function loadCard(cardUrl, editionDate) {
  const res = await fetch(cardUrl, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`card ${res.status}`);
  const blob = await res.blob();
  return new File([blob], cardFileName(editionDate), { type: 'image/png' });
}

export default function DailyShare({ cardUrl, editionDate, text, label = 'Share', className = 'sbd-copy' }) {
  const fileRef = useRef(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    let live = true;
    loadCard(cardUrl, editionDate).then((f) => { if (live) fileRef.current = f; }).catch(() => {});
    return () => { live = false; };
  }, [cardUrl, editionDate]);

  const say = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 1800); };

  const handleShare = async () => {
    let file = fileRef.current;
    if (!file) {
      try { file = await loadCard(cardUrl, editionDate); fileRef.current = file; } catch { file = null; }
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      const withFile = file && navigator.canShare?.({ files: [file] }) ? { files: [file], text } : null;
      try {
        await navigator.share(withFile ?? { text });
        return;
      } catch (e) {
        // A cancel is the reader's answer - leave it. Anything else (a refused
        // file share) falls through to the download + copy below.
        if (e?.name === 'AbortError') return;
      }
    }
    let saved = false;
    if (file) {
      try {
        const href = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = href; a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 4000);
        saved = true;
      } catch { /* the text still goes to the clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      say(saved ? 'Image saved · text copied' : 'Copied');
    } catch {
      say(saved ? 'Image saved' : null);
    }
  };

  return (
    <button type="button" className={className} onClick={handleShare} data-share-card={cardUrl}>
      {flash ?? label}
    </button>
  );
}
