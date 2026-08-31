// lib/shell/constants.js — shared sim-app shell constants.
// No server- or client-only imports, so BOTH the server resolver
// (lib/shell/shell.js) and the client bridge (lib/shell/bridge.js) can use them.
export const SHELL_PARAM = 'shell';   // ?shell=sim-app on the container's first hit
export const SHELL_VALUE = 'sim-app'; // discriminates the sim wrapper from the main /app wrapper
export const SHELL_COOKIE = 'sv_shell'; // persists the mode across client navigations

// THE CONTAINER'S OWN MARK, appended to the webview's User-Agent by
// capacitor.config.ts (server.appendUserAgent). It is the only thing in a
// request from /app that says "this is the app" - the binary loads /app with no
// query string, and /app is also a real web page, so the server cannot guess.
// proxy.js reads it; nothing else should.
//
// BAKED INTO THE BINARY. A copy built before this token shipped sends a plain
// webview UA and falls back to the client-side path
// (components/shell/NativeShellCookie), which still works. Changing this string
// silently strands every installed copy, so it is versioned rather than edited.
export const SHELL_UA_TOKEN = 'SportsvynApp/1';
