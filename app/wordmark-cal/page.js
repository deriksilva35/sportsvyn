// app/wordmark-cal/page.js — TEMPORARY macron calibration harness.
// noindex, no nav. Renders the canonical Wordmark in five translateX candidates
// at three sizes for on-device (iPhone Safari) comparison against the locked PNG.
// DELETE this route once Derik picks the winning percentage.
import Wordmark from '@/components/Wordmark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Wordmark calibration', robots: { index: false, follow: false } };

const TXS = ['-35%', '-30%', '-25%', '-20%', '-15%'];
const SIZES = [
  ['22px header', 'text-[22px]'],
  ['40px', 'text-[40px]'],
  ['80px', 'text-[80px]'],
];

export default function WordmarkCal() {
  return (
    <main style={{ background: '#0A0A0A', minHeight: '100vh', padding: '24px 18px 96px', color: '#F5F5F2', fontFamily: 'ui-monospace, Menlo, monospace' }}>
      <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A8A84', marginBottom: 4 }}>
        Macron calibration
      </div>
      <div style={{ fontSize: 12, color: '#8A8A84', marginBottom: 22, lineHeight: 1.5 }}>
        Pick the translateX % whose volt bar matches the locked PNG on your iPhone. Reply with the winning percentage.
      </div>

      {TXS.map((tx) => (
        <section key={tx} style={{ borderTop: '1px solid #262622', padding: '20px 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#D4FF00', marginBottom: 16, letterSpacing: '.04em' }}>
            translateX({tx})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {SIZES.map(([label, cls]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <span style={{ fontSize: 9, color: '#5A5A55', width: 66, flex: 'none', letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</span>
                <Wordmark sizeClassName={cls} macronTx={tx} />
              </div>
            ))}
          </div>
        </section>
      ))}

      <section style={{ borderTop: '1px solid #262622', padding: '20px 0', marginTop: 8 }}>
        <div style={{ fontSize: 12, color: '#8A8A84', marginBottom: 12, letterSpacing: '.04em' }}>LOCKED PNG REFERENCE — 80px scale</div>
        {/* The reference must live at public/wordmark-ref.png to appear on the
            deploy: untracked mocks/ files are not served by Vercel. If this is
            blank, drop the locked export at public/wordmark-ref.png and redeploy. */}
        <img src="/wordmark-ref.png" alt="(reference PNG not at public/wordmark-ref.png)" style={{ height: 80, display: 'block', maxWidth: '100%' }} />
        <div style={{ fontSize: 10, color: '#5A5A55', marginTop: 10, lineHeight: 1.5 }}>
          Blank? The locked PNG is not committed. Compare the strips above against the PNG on your device, or drop the export at public/wordmark-ref.png to embed it here.
        </div>
      </section>
    </main>
  );
}
