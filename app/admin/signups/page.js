import { sql } from '@/lib/db';
import TableControls from './TableControls';

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

export default async function SignupsPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  const tier = params.tier ?? 'all';
  const confirmed = params.confirmed ?? 'all';
  const sort = params.sort ?? 'newest';
  const orderBy = SORT_ORDERS[sort] ?? SORT_ORDERS.newest;

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
