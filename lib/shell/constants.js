// lib/shell/constants.js — shared sim-app shell constants.
// No server- or client-only imports, so BOTH the server resolver
// (lib/shell/shell.js) and the client bridge (lib/shell/bridge.js) can use them.
export const SHELL_PARAM = 'shell';   // ?shell=sim-app on the container's first hit
export const SHELL_VALUE = 'sim-app'; // discriminates the sim wrapper from the main /app wrapper
export const SHELL_COOKIE = 'sv_shell'; // persists the mode across client navigations
