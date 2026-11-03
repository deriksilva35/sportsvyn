// lib/games/lobbySection.js - one lobby module fails alone (3 Nov outage).
//
// THE RULE: a lobby module (the Daily card, the Weekly card, a registry read,
// a league list ...) loads inside section(). A throw is LOGGED to app_errors
// and replaced by the module's fallback, so the rest of the lobby renders.
// The whole-lobby fallback text belongs to a lobby that cannot build anything.
//
// WHAT app_errors GETS (lib/ops/appErrors.js recordAppError: one row per
// (service, stack_hash), a repeat is count+1):
//   service     'lobby:<module>'             e.g. 'lobby:weekly-card'
//   message     'route=<route> uh=<hash> :: <error message>'
//   stack_hash  the error's own hash (name + message + normalised frames)
// A page's own main read uses the same logger with ctx.service = 'page'
// (pageCatch below), so its name reads 'page:<route>:<read>'.
// uh is a short salted-free sha256 of the user id - never the id. Signed out
// is 'anon'. Logging never throws into the render: a failed write is one
// console.error (inside recordAppError) and the fallback is still returned.
import { createHash } from 'node:crypto';
import { recordWithin } from '../ops/appErrors.js';

export function userHash(uid) {
  if (uid == null) return 'anon';
  return createHash('sha256').update(`lobby-uid:${uid}`).digest('hex').slice(0, 10);
}

/** Write one lobby failure to app_errors. Never throws. */
export async function logLobbyError(name, err, ctx = {}) {
  const { route = null, uid = null, log = null } = ctx;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const tagged = Object.assign(new Error(`route=${route ?? '?'} uh=${userHash(uid)} :: ${e.message}`), { stack: e.stack, name: e.name });
    const write = log ?? ((service, error) => recordWithin(service, error));
    await write(`${ctx.service ?? 'lobby'}:${name}`, tagged);
  } catch (x) {
    try { console.error(`[lobby] could not log ${name}: ${String(x?.message ?? x).slice(0, 200)}`); } catch { /* nothing left */ }
  }
}

/** Run an async module; on a throw (or a rejected promise) log and return fallback. */
export async function section(name, fn, fallback, ctx = {}) {
  try {
    const run = ctx.inject?.[name] ?? fn;   // ctx.inject: a test's way to make ONE module throw
    return await (typeof run === 'function' ? run() : run);
  } catch (err) {
    await logLobbyError(name, err, ctx);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

/** The pure-shaper twin: runs fn(), a throw is logged (not awaited) and fallback returned. */
export function shaped(name, fn, fallback, ctx = {}) {
  try {
    return (ctx.inject?.[name] ?? fn)();
  } catch (err) {
    ctx.pending?.push(logLobbyError(name, err, ctx));
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

/** For a page's `.catch(...)` on the whole lobby read: log, then null. */
export function pageCatch(name, ctx, fallback = null) {
  return async (err) => { await logLobbyError(name, err, ctx); return fallback; };
}
