// crew/lib/db.mjs - read-only SQL as crew_reader over Neon's HTTP endpoint. No driver, no dependency.
//
// READ ONLY, three ways: the role itself has no write grants; every call is a batch whose first
// statement is SET LOCAL default_transaction_read_only = on; and the batch header
// Neon-Batch-Read-Only opens the transaction READ ONLY. (A write probe through this path fails
// with "cannot execute ... in a read-only transaction" - crew/lib/db.test.mjs pins the request shape.)
import { SetupError, redact, networkError, statusError, HTTP_TIMEOUT_MS } from './common.mjs';

export const READ_ONLY_PREAMBLE = 'SET LOCAL default_transaction_read_only = on';

/** The request for one read. PURE, so a test can pin the guard without a network. */
export function buildRequest(url, text, params = [], timeoutMs = 8_000) {
  const u = new URL(url);
  return {
    endpoint: `https://${u.host}/sql`,
    init: {
      method: 'POST',
      headers: {
        'Neon-Connection-String': url,
        'Content-Type': 'application/json',
        'Neon-Batch-Read-Only': 'true',
        'Neon-Batch-Isolation-Level': 'ReadCommitted',
      },
      body: JSON.stringify({
        queries: [
          { query: READ_ONLY_PREAMBLE },
          { query: `SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}` },
          { query: text, params },
        ],
      }),
    },
  };
}

/** -> rows (objects; bigint/numeric arrive as strings, so cast in SQL or Number() them). */
export async function query(url, text, params = [], { timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const { endpoint, init } = buildRequest(url, text, params, timeoutMs);
  const host = new URL(url).host;
  let res; let body;
  try {
    res = await fetchImpl(endpoint, { ...init, signal: AbortSignal.timeout(timeoutMs + 1500) });
    body = await res.json().catch((e) => { if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw e; return null; });
  } catch (e) {
    throw networkError(e, 'database', host);
  }
  if (!res.ok) {
    const code = body?.code ? ` (${body.code})` : '';
    const err = statusError(res.status, 'database', host);
    throw new SetupError(redact(`database error${code}: ${String(body?.message ?? res.status).slice(0, 160)}`), err.kind, host);
  }
  const results = body?.results;
  if (!Array.isArray(results) || !results.length) throw new SetupError('database returned no result', 'unreachable', host);
  return results.at(-1).rows ?? [];
}

export const num = (v) => (v === null || v === undefined ? null : Number(v));
