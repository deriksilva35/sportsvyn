'use client';

// components/leagues/LeagueChipActions.js - "+ Join" and "+ Create", beside the
// league chips, on a game's own board.
//
// NO WEB-ONLY STEP. The Run's board used to end with "Play with friends / Create
// a league from /leagues" - an instruction to leave the game, in an app where
// /leagues is a web page. Both writes happen here now, on the board the reader is
// already looking at, through the same two server actions /leagues uses.
//
// ONE SOURCE FOR THE CODE AND THE COPY. Everything about the six characters -
// the length, the cleaning, the refusal sentence, the share link - comes from
// lib/leagues/code.js, which is also what joinLeague() on the server reads. The
// sheet decides only whether six characters are present, because a submit that
// cannot possibly succeed should not cost a round trip; every other refusal is
// the server's own sentence rendered as handed over.
//
// PASTE OR TYPE. cleanLeagueInput runs at the keystroke and on paste, so
// "abcd-ef " becomes ABCDEF as it lands rather than being refused at submit.
//
// RELATIVE NAVIGATION. The share link is a path, never an origin: inside the
// container a friend's tap has to stay in the container.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createLeagueAction, joinLeagueAction } from '@/app/actions/leagues';
import { cleanLeagueInput, normalizeLeagueCode, joinHref, CODE_LENGTH, REFUSALS } from '@/lib/leagues/code';
import './leagueChips.css';

/**
 * @param boardHref  the game's own board path - where a successful join lands,
 *                   filtered to the league just joined. '/run/board' today.
 * @param signedIn   a signed-out reader gets the sign-in line, not a dead form.
 * @param signinHref where that line goes.
 */
export default function LeagueChipActions({ boardHref = '/run/board', signedIn = false, signinHref = '/signin' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(null);      // null | 'join' | 'create'
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const [made, setMade] = useState(null);      // { code, id } after a create

  const close = () => { setOpen(null); setErr(null); setCode(''); setName(''); setMade(null); };

  function submitJoin(e) {
    e.preventDefault();
    setErr(null);
    // THE ONLY CHECK THE CLIENT MAKES, and it produces the server's own sentence.
    if (!normalizeLeagueCode(code)) { setErr(REFUSALS.not_a_code); return; }
    start(async () => {
      const fd = new FormData();
      fd.set('code', normalizeLeagueCode(code));
      const res = await joinLeagueAction(fd).catch(() => ({ ok: false, reason: REFUSALS.failed }));
      if (!res.ok) { setErr(res.reason ?? REFUSALS.failed); return; }
      close();
      // THE BOARD, FILTERED TO WHAT THEY JUST JOINED - the point of joining.
      router.push(`${boardHref}?league=${res.leagueId}`);
      router.refresh();
    });
  }

  function submitCreate(e) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set('name', name);
      const res = await createLeagueAction(fd).catch(() => ({ ok: false, reason: 'Could not create the league' }));
      if (!res.ok) { setErr(res.reason ?? 'Could not create the league'); return; }
      // THE CODE AND THE LINK, HERE, before anybody navigates: the whole reason
      // to create one is to send it to somebody in the next thirty seconds.
      setMade({ code: res.joinCode, id: res.leagueId });
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="lgc-chip" aria-expanded={open === 'join'}
        onClick={() => { setOpen(open === 'join' ? null : 'join'); setErr(null); setMade(null); }}>+ Join</button>
      <button type="button" className="lgc-chip" aria-expanded={open === 'create'}
        onClick={() => { setOpen(open === 'create' ? null : 'create'); setErr(null); setMade(null); }}>+ Create</button>

      {open ? (
        <div className="lgc-sheet" role="group"
          aria-label={open === 'join' ? 'Join a league' : 'Create a league'}>
          {!signedIn ? (
            <p className="lgc-h">
              <a href={signinHref}>Sign in</a> to {open === 'join' ? 'join a league' : 'create one'}.
            </p>
          ) : open === 'join' ? (
            <form className="lgc-row" onSubmit={submitJoin} noValidate>
              <input
                className="lgc-in"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={CODE_LENGTH + 4}
                placeholder="6-character code"
                aria-label="League code"
                value={code}
                onChange={(e) => { setCode(cleanLeagueInput(e.target.value)); if (err) setErr(null); }}
                onPaste={(e) => {
                  const t = e.clipboardData?.getData('text');
                  if (t != null) { e.preventDefault(); setCode(cleanLeagueInput(t)); if (err) setErr(null); }
                }}
                disabled={pending}
              />
              <button type="submit" className="lgc-go" disabled={pending}>
                {pending ? 'Checking…' : 'Join'}
              </button>
            </form>
          ) : made ? (
            <div className="lgc-made">
              <p className="lgc-h">League created. Send this:</p>
              <p className="lgc-code">{made.code}</p>
              <a className="lgc-link" href={joinHref(made.code)}>{joinHref(made.code)}</a>
              <button type="button" className="lgc-go" onClick={close}>Done</button>
            </div>
          ) : (
            <form className="lgc-row" onSubmit={submitCreate} noValidate>
              <input
                className="lgc-in"
                type="text"
                maxLength={40}
                autoComplete="off"
                placeholder="League name"
                aria-label="New league name"
                value={name}
                onChange={(e) => { setName(e.target.value); if (err) setErr(null); }}
                disabled={pending}
              />
              <button type="submit" className="lgc-go" disabled={pending || name.trim().length < 3}>
                {pending ? 'Creating…' : 'Create'}
              </button>
            </form>
          )}
          {err ? <p className="lgc-err" role="alert">{err}</p> : null}
        </div>
      ) : null}
    </>
  );
}
