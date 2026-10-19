/**
 * /admin/morning-email - THE PREVIEW (sun-2). Gated by proxy.js Basic Auth, like
 * every /admin page. Renders today's morning email as one account would get it
 * (?as=<userId>, default the first audience member), plus the audience count by
 * reason and the kill switch's state. Read-only: it never sends.
 */
import { sql } from '@/lib/db';
import { morningAudience } from '@/lib/email/morningAudience';
import { OWNER_ADDRESSES } from '@/lib/email/owners';
import { loadDay, loadReader, composeFor, etDay, morningEnabled } from '@/lib/email/morningSend';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Morning email - admin', robots: { index: false, follow: false } };

export default async function MorningEmailPreview({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const audience = await morningAudience(sql, { owners: OWNER_ADDRESSES });
  const why = audience.reduce((m, a) => (m[a.why] = (m[a.why] ?? 0) + 1, m), {});
  const asId = Number(sp.as) || audience[0]?.id || null;
  const day = etDay();
  const dayData = await loadDay(day);
  const mail = asId
    ? composeFor({ dayData, reader: await loadReader(dayData, asId), unsubscribeUrl: '#unsubscribe', player: true, link: (p) => `https://sportsvyn.com${p}` })
    : null;
  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20 }}>Morning email - {day}</h1>
      <p data-switch={morningEnabled() ? 'on' : 'off'}>Kill switch MORNING_EMAIL: <b>{morningEnabled() ? 'ON - the 15:00Z cron sends' : 'OFF - the cron sends nothing'}</b></p>
      <p data-audience={audience.length}>Audience today: <b>{audience.length}</b> ({Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})</p>
      {mail ? (
        <>
          <p>As user {asId} · <b>{mail.subject}</b></p>
          <iframe title="Morning email preview" srcDoc={mail.html} style={{ width: '100%', maxWidth: 620, height: 900, border: '1px solid silver' }} />
        </>
      ) : <p>Nobody in the audience to render as.</p>}
    </main>
  );
}
