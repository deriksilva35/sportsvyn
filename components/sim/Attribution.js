// components/sim/Attribution.js — FFC attribution line. LICENSE REQUIREMENT: any
// surface rendering FFC ADP data must show this. Presentational; the pages pass
// the exported FFC_ATTRIBUTION constant so the text stays single-sourced.
export default function Attribution({ text, url }) {
  return (
    <footer className="sim-foot">
      {text} · <a href={url} target="_blank" rel="noopener noreferrer">fantasyfootballcalculator.com</a>
    </footer>
  );
}
