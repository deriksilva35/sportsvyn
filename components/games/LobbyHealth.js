// components/games/LobbyHealth.js - the lobby's one machine marker (crew lobby-probe, 3 Nov).
//
// <div hidden data-sv-lobby-health="" data-modules="45" data-hidden="2"
//      data-hidden-names="daily-home,tonight" data-signed-in="1">
//
// crew/bin/lobby-probe loads GET / as the probe account and reads this to tell a lobby
// that rendered whole from one where a module was hidden by an error (lib/games/
// lobbySection.js collects it per request). MODULE KEYS ONLY: no user id, no message.
// `hidden` keeps it out of sight and out of the accessibility tree; it is not styled,
// not interactive and carries no script. Server component: no props reach the client.
export default function LobbyHealth({ health, signedIn = false }) {
  const hidden = Array.isArray(health?.hidden) ? health.hidden : [];
  return (
    <div
      hidden
      data-sv-lobby-health=""
      data-modules={Number(health?.modules) || 0}
      data-hidden={hidden.length}
      data-hidden-names={hidden.join(',')}
      data-signed-in={signedIn ? '1' : '0'}
    />
  );
}
