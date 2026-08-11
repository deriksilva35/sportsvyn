import { sql } from '@/lib/db';
import TableControls from './TableControls';
import { welcomeLedgerSummary } from '@/lib/auth/welcomeEmail';

/**
 * Admin signups view — Session 3d.
 *
 * Server Component listing rows from email_signups with filter dropdowns
 * (tier, confirmed) and sort, plus CSV export. Gated by proxy.js Basic
 * Auth (matcher already covers /admin/:path*) — no per-page auth needed.
 *
 * SQL strategy: a single sql`...` tagged template with boolean
 * short-circuit predicates in the WHERE clause keeps the query fully
 * parameterized while supporting "all" / specific filter values. The
 * ORDER BY column can't be parameterized as a value, so `sort` resolves
 * through a whitelisted map of nested sql fragments (any unknown input
 * silently falls back to newest).
 *
 * Date format is server-rendered in America/Los_Angeles so the same
 * string ships to every browser regardless of locale or timezone.
 * Tier / Source display values are capitalized for readability; raw
 * lowercase values stay in the database and in the CSV export.
 */

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatSource(s) {
  if (!s) return '';
  return capitalize(s.replace(/_/g, ' '));
}

// noindex. Every other app/admin page declares this; this one did not, so it was
// the sole admin route with no robots block. proxy.js Basic Auth means a crawler
// gets a 401 rather than content, but Disallow + noindex is the belt-and-braces the
// rest of /admin already has. Policy: lib/seo/routes.js.
export const metadata = {
  title: 'Signups - Admin',
  robots: { index: false, follow: false },
};

const SORT_ORDERS = {
  newest:     sql`created_at DESC`,
  oldest:     sql`created_at ASC`,
  email_asc:  sql`email ASC`,
  email_desc: sql`email DESC`,
};

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'America/Los_Angeles',
});

function formatCreatedAt(date) {
  const parts = DATE_FMT.formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
}


// The welcome-email ledger, summarised.
//
// STUCK and MISSING are the two rows that matter and they mean different
// things. STUCK is a send that opened and never closed - the mail may or may
// not have gone out, and alreadySent() refuses to retry it, so it needs a human
// decision. MISSING is a user with no ledger row at all, which after the
// before-send inversion should only ever be an account predating the hook;
// anything newer means the hook did not fire, which is the original defect.
//
// Both are shown as counts first because the useful daily question is "is it
// zero", and only expanded when it is not.
function WelcomeLedger({ ledger }) {
  const stuck = ledger.stuck ?? [];
  const missing = ledger.missing ?? [];
  const clean = stuck.length === 0 && missing.length === 0;
  return (
    <section className="max-w-7xl mx-auto mt-8 border border-charcoal p-4">
      <div className="flex items-baseline gap-4 flex-wrap">
        <span className="font-mono text-xs uppercase tracking-widest text-muted">Welcome email</span>
        {ledger.byOutcome.map((o) => (
          <span key={o.outcome} className="font-mono text-xs text-paper-warm">
            {o.outcome} <b className="text-volt">{o.n}</b>
          </span>
        ))}
        <span className={`font-mono text-xs ml-auto ${clean ? 'text-muted' : 'text-terra'}`}>
          {clean ? 'no gaps' : `${stuck.length} stuck · ${missing.length} missing`}
        </span>
      </div>

      {stuck.length > 0 && (
        <div className="mt-3">
          <div className="font-mono text-[11px] uppercase tracking-widest text-terra">
            Stuck at sending over {ledger.stuckAfterMinutes} min - may or may not have been delivered
          </div>
          <ul className="mt-1 font-mono text-xs text-paper-warm">
            {stuck.map((r) => (
              <li key={r.id}>#{r.id} user {r.user_id} opened {formatCreatedAt(r.started_at)}</li>
            ))}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="mt-3">
          <div className="font-mono text-[11px] uppercase tracking-widest text-terra">
            Users with no ledger row - the hook did not run
          </div>
          <ul className="mt-1 font-mono text-xs text-paper-warm">
            {missing.map((u) => (
              <li key={u.id}>user {u.id} {u.email} created {formatCreatedAt(u.created_at)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function SignupsPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  const tier = params.tier ?? 'all';
  const confirmed = params.confirmed ?? 'all';
  const sort = params.sort ?? 'newest';
  const orderBy = SORT_ORDERS[sort] ?? SORT_ORDERS.newest;

  // The welcome-email ledger, read alongside the signup list because they are
  // the same question from two directions: who arrived, and did we manage to
  // say hello. Nothing read this table before, and the cost of that was four
  // days of not noticing a user had been missed.
  const ledger = await welcomeLedgerSummary().catch(() => null);

  const rows = await sql`
    SELECT *
    FROM email_signups
    WHERE (${tier === 'all'} OR tier = ${tier})
      AND (
        ${confirmed === 'all'}
        OR (${confirmed === 'yes'} AND confirmed_at IS NOT NULL)
        OR (${confirmed === 'no'}  AND confirmed_at IS NULL)
      )
    ORDER BY ${orderBy}
  `;

  return (
    <div className="min-h-screen px-6 py-8">
      <header className="max-w-7xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-widest text-muted mb-2">
          Admin
        </p>
        <h1 className="font-display font-black text-3xl text-paper-warm">
          Signups
        </h1>
        <p className="font-serif italic text-muted text-sm mt-1">
          {rows.length} {rows.length === 1 ? 'signup' : 'signups'}
        </p>
      </header>

      {ledger && <WelcomeLedger ledger={ledger} />}

      <div className="max-w-7xl mx-auto mt-8">
        <TableControls
          signups={rows}
          tier={tier}
          confirmed={confirmed}
          sort={sort}
        />

        <table className="w-full mt-6 border-collapse">
          <thead>
            <tr className="border-b border-charcoal text-muted font-mono text-xs uppercase tracking-widest">
              <th className="text-left py-3 pr-4">Email</th>
              <th className="text-left py-3 pr-4">Tier</th>
              <th className="text-left py-3 pr-4">Confirmed</th>
              <th className="text-left py-3 pr-4">Source</th>
              <th className="text-left py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-center py-12 text-muted font-serif italic"
                >
                  No signups match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-charcoal/50 text-paper-warm hover:bg-graphite/50"
                >
                  <td className="py-3 pr-4 text-sm">{row.email}</td>
                  <td className="py-3 pr-4 text-sm">{capitalize(row.tier)}</td>
                  <td className="py-3 pr-4 text-sm">
                    {row.confirmed_at ? 'Yes' : 'No'}
                  </td>
                  <td className="py-3 pr-4 text-sm">{formatSource(row.source)}</td>
                  <td className="py-3 text-sm">{formatCreatedAt(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
