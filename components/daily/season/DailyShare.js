'use client';

/**
 * components/daily/season/DailyShare.js - the Daily's share button: an IMAGE
 * card (app/daily/board/[date]/card, 1080x1680) plus its lines of text.
 *
 * THREE ROUTES, CHOSEN BY FEATURE TEST (lib/daily/shareRoute.js):
 *   1. navigator.canShare({ files, text }) -> navigator.share with the file
 *   2. the app shell's existing bridge (lib/shell/bridge.js sendShare,
 *      postMessage { type: 'share', url, title })
 *   3. download the image + copy the text (desktop)
 * No user-agent check anywhere - the shell is known by its cookie and its
 * native container, the browser by what it says it can share.
 *
 * THE IMAGE IS FETCHED BEFORE THE TAP. Safari ties navigator.share to the
 * tap's user activation, and a share that first awaits a network fetch can
 * lose it. So the card is fetched once on mount and held as a File; the tap
 * hands it straight to share(). A tap that beats the fetch still fetches.
 */

import { useEffect, useRef, useState } from 'react';
import { cardFileName, SHARE_HREF } from '@/lib/daily/shareCard';
import { runShare } from '@/lib/daily/shareRoute';
import { sendShare } from '@/lib/shell/bridge';

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

  // DOWNLOAD + COPY: the route for a browser with no share sheet and no shell.
  const downloadAndCopy = async (file) => {
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

  const handleShare = async () => {
    let file = fileRef.current;
    if (!file) {
      try { file = await loadCard(cardUrl, editionDate); fileRef.current = file; } catch { file = null; }
    }
    await runShare({
      file, text, url: SHARE_HREF,
      nav: typeof navigator !== 'undefined' ? navigator : null,
      sendShare,
      fallback: () => downloadAndCopy(file),
    });
  };

  return (
    <button type="button" className={className} onClick={handleShare} data-share-card={cardUrl}>
      {flash ?? label}
    </button>
  );
}
