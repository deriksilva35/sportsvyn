// components/games/LobbyMain.js - the lobby's <main>, one render for its two doors
// (tue-3): /games and / under the arcade theme. PRESENTATIONAL ON PURPOSE: each
// page keeps its own header, its own shell sign-in guard with its OWN
// destination, and its own lobby read, in its own source - the invariants
// lib/shell/signedOut.test.mjs holds every guarded tab to. Only the drawing is
// shared, so the two doors cannot drift apart.
import LobbyV3 from '@/components/games/LobbyV3';
import { shellSigninHref } from '@/lib/shell/signinHref';
import TzCookie from '@/components/gridiron/TzCookie';

export default function LobbyMain({ v, chip, userId = null, isShell = false }) {
  return (
    <main className="lob lv" data-surface="ink">
      {/* sv_tz, so the Play lobby's next server paint is already in the
          reader's zone (its times and its header's zone label agree). */}
      <TzCookie />
      {v
        ? (
          <LobbyV3
            v={v}
            chip={chip}
            signedIn={userId != null}
            signinHref={(dest) => shellSigninHref(dest, isShell)}
            userId={userId == null ? null : Number(userId)}
          />
        )
        : (
          <section className="mod">
            <p className="muted">The lobby is having a moment. Try again shortly.</p>
          </section>
        )}
    </main>
  );
}
