'use client';

/**
 * AgeForm - three empty pickers and one button. NOTHING IS PRESELECTED: each
 * select opens on its own placeholder ("Month", "Day", "Year"), so the
 * screen never suggests an answer, adult or otherwise. The year list runs from
 * this year backwards with no gap or marker at any age.
 *
 * The device flag (localStorage, ./deviceFlag.js) is read here and sent
 * with the answer; it can only make the server stricter.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitDateOfBirth } from '@/app/actions/age';
import { deviceBlocked, setDeviceBlocked } from './deviceFlag';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const SELECT = 'age-select w-full px-3 py-3 bg-graphite border border-charcoal rounded text-paper-warm focus:outline-none focus:border-volt disabled:opacity-50';

export default function AgeForm({ next = '/games' }) {
  const router = useRouter();
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => thisYear - i);

  async function onSubmit(e) {
    e.preventDefault();
    if (!month || !day || !year) { setError('Choose a month, a day and a year.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await submitDateOfBirth({ month, day, year }, next, deviceBlocked());
      if (res?.blocked) {
        setDeviceBlocked();
        router.replace(res.next);
        router.refresh();
        return;
      }
      if (res?.ok) {
        router.replace(res.next);
        router.refresh();
        return;
      }
      setError(res?.message ?? 'Something went wrong. Try again.');
    } catch {
      setError('Something went wrong. Try again.');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 w-full" data-age-form>
      <fieldset className="age-fields" disabled={busy}>
        <legend className="sr-only">Date of birth</legend>
        <label className="sr-only" htmlFor="dob-month">Month</label>
        <select id="dob-month" name="month" value={month} onChange={(e) => setMonth(e.target.value)} className={SELECT}>
          <option value="" disabled>Month</option>
          {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="dob-day">Day</label>
        <select id="dob-day" name="day" value={day} onChange={(e) => setDay(e.target.value)} className={SELECT}>
          <option value="" disabled>Day</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={String(d)}>{d}</option>)}
        </select>
        <label className="sr-only" htmlFor="dob-year">Year</label>
        <select id="dob-year" name="year" value={year} onChange={(e) => setYear(e.target.value)} className={SELECT}>
          <option value="" disabled>Year</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </fieldset>
      <button
        type="submit"
        disabled={busy}
        className="si-cta mt-4 w-full px-4 py-3 bg-volt text-ink font-mono font-medium uppercase tracking-widest text-sm rounded hover:bg-volt/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Saving…' : 'Continue'}
      </button>
      <div className="mt-4 min-h-6 text-sm text-muted" aria-live="polite">{error}</div>
    </form>
  );
}
