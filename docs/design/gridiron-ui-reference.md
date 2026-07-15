# Gridiron UI component grammar (transcribed from locked mocks
# scoreboard-v3-field / nfl-today-v1 / home-daily-card-v1)

## Network header (ink, sticky)
Row: wordmark · nav tabs (JetBrains Mono 12px, letter-spacing .14em,
uppercase, --muted, active --paper with 2px volt underline at bottom:-2px)
· right: MY SPORTSVYN link + member chip (mono 9px, ink-on-volt, 4px 10px).
background rgba(10,10,10,.96) + backdrop blur, border-bottom 1px --charcoal.
Tab set when it eventually ships: TODAY SCORES NFL CFB SOCCER - but THIS
SESSION the existing site header stays untouched; new routes render their
own local shell.

## Sport sub-nav (ink band under header)
Tabs mono 11px ls .16em uppercase --muted, padding 13px 16px, active =
--volt with 2px volt underline. Right-pinned season-state readout: mono
9px ls .2em --muted-dim, e.g. "2025 SEASON · WEEK 4" with values --paper.
NFL tabs: Today · Scores & Schedule · Rankings · Market · Fantasy · Stats
· Reads. CFB: swap Fantasy for Standings.

## Section kicker (ink surfaces)
mono 10px 700 ls .28em uppercase --volt + flex 1px --rule-dim rule +
optional right link (mono 10px --muted, hover --volt).

## Watch Score chip
label mono 8px ls .2em --muted-dim uppercase "WATCH" + value Saira 900
italic 19-22px --paper with border-bottom 3px --volt; .hot = value --volt;
.dim (finals) = value --muted, border --charcoal.

## Status column (three temperatures)
LIVE: mono 11-12px 700 --live + 8px pulsing dot (@keyframes pulse opacity
1->0.25 1.6s). FINAL: chip mono 9px 700 ls .2em uppercase --paper on
--jade, 3px 10px; overtime variant F/OT outlined (--graphite-up bg,
--jade text+border). UPCOMING: mono 12px --paper-dim time + network line
mono 9px ls .14em --muted-dim uppercase.

## Game card (two-up grid, /scores)
grid-template-columns:1fr 1fr, gap 14px; card border 1px --rule, hover
border --muted-dim; expanded card grid-column:1/-1 + border --volt +
chevron rotates. Card body: status row (status left, chevron right) ->
team lines -> foot (line left, Watch chip right, border-top 1px
--rule-dim). Team line: mono 14px; rank prefix mono 10px --volt width
24px; record mono 10px --muted-dim; score right-aligned 16px, winner 700,
loser entirely --muted; possession marker volt ◆ 9px.
Expanded detail: tab bar on --graphite (mono 10px 700 tabs, active volt
underline) + right-pinned "Full match page →" link; panes = Key Moments
(clock Saira 900 italic 17px volt + small mono label / head Saira Cond
700 12px with volt type tag / desc Source Serif italic 13px --paper-dim /
right WP swing mono, negative variant --terra) and Play by Play rows
(mono: down-distance 10px --muted / text 12px --paper-dim with bold
--paper on scoring / gain right +volt -terra; scoring rows bg --graphite).
Pre-game cards: single "Why Watch" pane (Watch Score + one-line read).

## Drive Strip (live football cards only - named component)
Inline SVG viewBox 0 0 240 46: field rect y6 h34 --graphite; end zones
x0 and x220 w20 --graphite-up; yard lines every 20 units stroke --rule
(midfield #3A3A3A, tiny mono "50" label); drive-so-far trail = volt rect
h4 opacity .18 from drive start to ball; first-down line = dashed
(3 2) 1.5px --paper vertical; ball = volt diamond path (7-unit) at
x = 220 - yardsToEndzone*2 (drive pointing right) + small volt arrow.
Caption under (mono 9px ls .14em uppercase --muted): "◆ TEAM · 2nd & 6 ·
OPP 34 · first down at the 28" with team+down bold --volt, first-down
clause --paper-dim. Renders ONLY on live football (never soccer, never
pre/final).

## Filter chips (/scores toolbar)
mono 10px 700 ls .18em uppercase --muted, border 1px --rule, 8px 16px;
active = ink-on-volt; live-only toggle active = --paper on --live.
Date nav: bordered group, ‹ date › with day bold volt.

## Sport section header (/scores)
mono 10px 700 ls .28em uppercase --volt sport name + count mono 9px
--muted-dim + flex rule + right link. Empty-day state: dashed 1px --rule
box, mono 11px --muted-dim, e.g. "No NFL today · Tomorrow's slate: 13
games →" - sports keep their place, never vanish.

## Paper-surface grammar (for the Today pages' lede zone)
Body ground --paper, text --ink/--ink-soft, rules --p-rule. Kicker = 14px
volt square + ink mono text. Lede: kicker line mono 10px --ink-mut ->
headline Saira 900 italic uppercase 40-46px --ink (hover 5px volt
underline offset 6px) -> Source Serif italic 17-18px --ink-soft with
first-letter drop cap ink-on-volt (Saira 900, padding 2px 8px) -> meta
mono 10px --ink-dim. Standings rail: border-left 1px --p-rule; division
labels Saira Cond 700 10px ink with 3px volt left bar; rows mono 12px.
