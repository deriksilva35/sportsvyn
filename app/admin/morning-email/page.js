/**
 * /admin/morning-email - THE PREVIEW (sun-2). Gated by proxy.js Basic Auth, like
 * every /admin page. Renders today's morning email as one account would get it
 * (?as=<userId>, default the first audience member), plus the audience count by
 * reason and the kill switch's state. Read-only: it never sends.
 * tue-4: the daily summary (sent / delivered / opened / real clicks / played, scanner
 * clicks removed - lib/email/emailMetrics.js) and the owner / house / test roster.
 */
import { sql } from '@/lib/db';
import { morningAudience } from '@/lib/email/morningAudience';
import { OWNER_ADDRESSES } from '@/lib/email/owners';
import { morningDaily } from '@/lib/email/morningStats';
import { testAccountRoster } from '@/lib/email/morningAudience';
import { loadDay, loadReader, composeFor, etDay, morningEnabled } from '@/lib/email/morningSend';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Morning email - admin', robots: { index: false, follow: false } };

export default async function MorningEmailPreview({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const audience = await morningAudience(sql, { owners: OWNER_ADDRESSES });
  const why = audience.reduce((m, a) => (m[a.why] = (m[a.why] ?? 0) + 1, m), {});
  const asId = Number(sp.as) || audience[0]?.id || null;
  const day = etDay();
  const daily = await morningDaily({ days: 14 }).catch(() => []);
  const roster = await testAccountRoster(sql, { owners: OWNER_ADDRESSES }).catch(() => []);
  const dayData = await loadDay(day);
  const mail = asId
    ? composeFor({ dayData, reader: await loadReader(dayData, asId), unsubscribeUrl: '#unsubscribe', player: true, link: (p) => `https://sportsvyn.com${p}` })
    : null;
  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20 }}>Morning email - {day}</h1>
      <p data-switch={morningEnabled() ? 'on' : 'off'}>Kill switch MORNING_EMAIL: <b>{morningEnabled() ? 'ON - the 15:00Z cron sends' : 'OFF - the cron sends nothing'}</b></p>
      <p data-audience={audience.length}>Audience today: <b>{audience.length}</b> ({Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})</p>
      <h2 style={{ fontSize: 16 }}>Last 14 days</h2>
      <table data-daily style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>{['Day', 'Sent', 'Delivered', 'Opened', 'Real clicks', 'Scanner clicks (excluded)', 'Recipients who played'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '2px 10px', borderBottom: '1px solid silver' }}>{h}</th>)}</tr></thead>
        <tbody>
          {daily.length ? daily.map((r) => (
            <tr key={r.day}>{[r.day, r.sent, r.delivered, r.opened, r.clicks, r.scannerClicks, r.played].map((v, i) => <td key={i} style={{ padding: '2px 10px' }}>{v}</td>)}</tr>
          )) : <tr><td colSpan={7} style={{ padding: '2px 10px' }}>No sends yet.</td></tr>}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: 'gray' }}>Opens and clicks need Resend open/click tracking ON for the sending domain and the webhook subscribed to email.opened / email.clicked.</p>
      <h2 style={{ fontSize: 16 }}>Owner / house / test accounts</h2>
      <ul data-roster style={{ fontSize: 13 }}>
        {roster.map((t) => <li key={t.id}>user {t.id} · {t.email || '(no address)'} · {t.house ? 'house' : 'owner'} · {t.included ? 'MAILED' : `not mailed: ${t.reason}`}</li>)}
      </ul>
      {mail ? (
        <>
          <p>As user {asId} · <b>{mail.subject}</b></p>
          <iframe title="Morning email preview" srcDoc={mail.html} style={{ width: '100%', maxWidth: 620, height: 900, border: '1px solid silver' }} />
        </>
      ) : <p>Nobody in the audience to render as.</p>}
    </main>
  );
}
