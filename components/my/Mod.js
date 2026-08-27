// components/my/Mod.js - the dashboard's module shell, per mock v0_2.
//
// ONE SHELL, and it is the front page's .mod card rather than the WC-era
// my-panel vocabulary it replaces. The two surfaces now share a grammar: a
// bordered ink card, an eyebrow, rows with a left label and a right value.
//
// THE EYEBROW IS VOLT. That is mock v0_2's amendment to v1.2 and it is scoped:
// eyebrows INSIDE modules only. Page-level tags stay muted, the hero eyebrow
// keeps its dark gradient tone, and volt text on paper remains forbidden. The
// style itself is defined in my.css where the amendment is recorded.

export function Mod({ tag, children, cta, ctaHref }) {
  return (
    <section className="mod">
      <span className="tag">{tag}</span>
      {children}
      {cta ? <a className="cta2" href={ctaHref}>{cta} &rarr;</a> : null}
    </section>
  );
}

/** A row: label (with optional sub-line) left, value right. */
export function Row({ label, sub, value, valueClass, muted }) {
  return (
    <div className="row">
      <div className={`l${muted ? ' mut' : ''}`}>
        {label}
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className={`r${valueClass ? ` ${valueClass}` : ''}`}>{value}</div>
    </div>
  );
}

/** The zero-state prompt shared by Schedule and Players. */
export function Prompt({ line, cta, ctaHref }) {
  return (
    <>
      <p className="promptline">{line}</p>
      <a className="cta2" href={ctaHref}>{cta} &rarr;</a>
    </>
  );
}

export function StatePill({ children }) {
  return <span className="statepill mut">{children}</span>;
}
