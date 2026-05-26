'use client';

/**
 * Filter dropdowns + CSV export for /admin/signups.
 *
 * Three native <select> dropdowns auto-update the URL via router.replace
 * on change — no Submit button — so the parent Server Component re-runs
 * with new searchParams. Using replace (not push) keeps filter changes
 * out of browser history.
 *
 * CSV export serializes the full row set passed in via `signups` prop
 * (13 columns including confirmation_token — admin auth gates this).
 * Filename uses today's date in America/Los_Angeles so it matches the
 * timezone used for the rendered Created column.
 */

import { useRouter } from 'next/navigation';

const CSV_COLUMNS = [
  'id',
  'email',
  'tier',
  'sports_interests',
  'created_at',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'confirmed_at',
  'confirmation_token',
  'unsubscribed_at',
  'notes',
];

const FILENAME_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/Los_Angeles',
});

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let str;
  if (Array.isArray(value)) str = value.join(',');
  else if (value instanceof Date) str = value.toISOString();
  else str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function buildCSV(signups) {
  const header = CSV_COLUMNS.join(',');
  const rows = signups.map((row) =>
    CSV_COLUMNS.map((col) => csvEscape(row[col])).join(',')
  );
  return [header, ...rows].join('\n');
}

function downloadCSV(signups) {
  const csv = buildCSV(signups);
  const date = FILENAME_DATE_FMT.format(new Date());
  const filename = `sportsvyn-signups-${date}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SELECT_CLASS =
  'bg-graphite border border-charcoal rounded text-paper-warm px-3 py-2 text-sm focus:outline-none focus:border-volt';

export default function TableControls({ signups, tier, confirmed, sort }) {
  const router = useRouter();

  function updateFilter(key, value) {
    const next = new URLSearchParams({ tier, confirmed, sort, [key]: value });
    router.replace(`/admin/signups?${next.toString()}`);
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          aria-label="Filter by tier"
          value={tier}
          onChange={(e) => updateFilter('tier', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="all">All tiers</option>
          <option value="free">Free</option>
          <option value="founding">Founding</option>
          <option value="paid">Paid</option>
          <option value="comp">Comp</option>
          <option value="churned">Churned</option>
        </select>

        <select
          aria-label="Filter by confirmation"
          value={confirmed}
          onChange={(e) => updateFilter('confirmed', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="yes">Confirmed</option>
          <option value="no">Unconfirmed</option>
        </select>

        <select
          aria-label="Sort by"
          value={sort}
          onChange={(e) => updateFilter('sort', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="email_asc">Email A→Z</option>
          <option value="email_desc">Email Z→A</option>
        </select>
      </div>

      <button
        type="button"
        onClick={() => downloadCSV(signups)}
        className="bg-volt text-ink font-mono font-medium uppercase tracking-widest text-xs px-4 py-2 rounded hover:bg-volt/90"
      >
        Export CSV
      </button>
    </div>
  );
}
