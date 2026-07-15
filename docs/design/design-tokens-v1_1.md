# Sportsvyn Design Tokens v1.1 + The Surface Rule

## Core tokens (CSS custom properties)
--ink:#0A0A0A  --graphite:#1A1A1A  --graphite-up:#242424  --charcoal:#2A2A2A
--rule:#2E2E2E  --rule-dim:#1F1F1F
--paper:#F5F5F2  --paper-dim:#C5C5C2  --muted:#888888  --muted-dim:#5A5A5A
--volt:#D4FF00  --volt-dim:#8FAA00
--live:#E63946  --jade:#2A8A4F (Final/positive)  --terra:#B8410F (negative)
Paper-surface text/structure (paper grounds ONLY):
--ink-soft:#333330  --ink-mut:#6B6B66  --ink-dim:#9A9A94
--p-rule:#DEDED8  --p-rule-soft:#E8E8E2

## Fonts (Google Fonts)
Saira ital,wght@1,900 (wordmark + headlines, always italic 900, letter-spacing
-0.04em to -0.05em, uppercase) · Saira Condensed 500-700 (tags/labels) ·
JetBrains Mono 400-700 (ALL data, numbers, nav, meta) · Source Serif 4
ital 400-500 (editorial prose + descriptions) · Archivo 400-500 (base sans).

## THE SURFACE RULE (hybrid)
Prose surfaces = PAPER ground. Data surfaces = INK ground. Instruments
(slates, boards, cards, charts, score heroes) have ONE rendering - ink -
and sit as ink blocks on paper. Implementation: data-surface="ink|paper"
attribute on the page shell; components consume tokens, never per-component
theme conditionals.
INK surfaces: /scores, schedules, match PRE+LIVE, market, rankings, stats,
My Sportsvyn, sim, usage/waiver boards.
PAPER surfaces: Daily Card homepage, sport Today pages, article reader,
Briefs, tag pages, methodology, match FINAL state.
Header + footer are ALWAYS ink brand bands; on paper grounds they close
with a 3px volt rule. Wordmark NEVER renders on paper directly.
VOLT ON PAPER = material only, never text color: 14px volt squares before
ink kicker text, ink-on-volt drop caps/chips, 3-4px volt left bars, 2px
volt link underlines, 5px volt headline hover underline.
Match page temperature rule: ink while pre/live -> paper frame when final.

## Wordmark markup (never rebuild, always this pattern)
<a class="wordmark">SPORTSV<span class="y-wrap">Y<span class="macron">
</span></span>N</a>
.wordmark{font-family:Saira;font-weight:900;font-style:italic;
letter-spacing:-0.05em;line-height:1;color:var(--paper);text-transform:
uppercase;display:inline-flex;align-items:baseline}
.y-wrap{position:relative;color:var(--volt);display:inline-block}
.y-wrap .macron{position:absolute;left:0;top:-0.05em;width:115%;
height:0.07em;background:var(--volt);transform:translateX(-35%)}
