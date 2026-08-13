# Post-season debt

Work that is deliberately deferred until the season is over, with the reason it
was deferred. Two rules for this file:

- **An item lands here only when the decision to defer was made**, not when
  somebody notices a gap. "We should probably" is not debt; "we chose not to,
  because" is.
- **Every item names what it costs today.** Debt with no stated cost is a wish
  list, and a wish list is not something anyone comes back to.

---

## Headless browser testing (Playwright)

**Deferred:** 13 Aug 2026, before the first preseason slate.

**What is missing.** There is no browser on the droplet, so nothing in this repo
can render a page and measure it. Two categories of check are unreachable as a
result:

1. **Viewport-dependent layout.** Whether the mobile header actually collapses
   at 390px, whether six game rows actually fit a phone screen, whether a title
   actually wraps.
2. **Client interaction.** Whether the drawer opens on tap, whether the game
   page's tab rail switches panels, whether the PPR/Half/Standard toggle
   re-sorts the tables, whether the "All groups" disclosure expands. All of it
   is client state, and all of it is currently asserted on source rather than on
   behaviour.

**What we do instead, and where it falls short.** Layout is checked by resolving
the cascade directly from the stylesheets a page serves - keep the rules whose
media conditions hold at a given width, pick the winner by specificity and
source order. That caught the real bug (see below) and is genuinely useful, but
it proves what the CSS *says*, not what the browser *draws*: it cannot see box
sizes, overflow, wrapping, or anything computed from content. Interaction is
checked by asserting the handlers and state exist in source, which cannot tell
you they work.

**What it cost, concretely.** The one global header shipped with a mobile
collapse that never engaged. `.gh-right` and `.gi-head-right` are both (0,1,0)
and live in different CSS chunks, so the winner depended on chunk order and it
lost - the served sheet had the hide at byte 10153 and the show at byte 11232.
Every phone visitor got a crushed wordmark, a nav truncated to "TC", and no
drawer. It reached real screenshots on a real phone before anyone knew. A
render test at 390px would have caught it in the same minute it was written.

**Why deferred.** Playwright is a heavy dependency to add to a droplet during a
live season, and the immediate bug was fixable and verifiable without it.

---

## Client-interaction tests

Folded into the item above - they need the same browser. Listed separately
because they are a different kind of gap: the layout checks have a partial
substitute, and the interaction checks have none at all. The tab rail, the
scoring toggle, the group disclosure and the WelcomeSheet's four exit paths are
all asserted to EXIST and none is asserted to WORK.
