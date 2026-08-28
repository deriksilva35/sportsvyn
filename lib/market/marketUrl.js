// lib/market/marketUrl.js — ONE url builder for every control on /market.
//
// WHY THIS EXISTS. Three hand-built href functions had grown side by side -
// one for the tab row, one for the view toggle, one for everything else - and
// each knew about a different subset of the page's state. Clicking a sort
// header on the LINES table returned the reader to the CARDS view, because the
// sort link was built by a helper whose only notion of `view` was "charts or
// nothing". It was invisible on PROPS purely because table is that tab's
// unmarked default, so dropping the param changed nothing there.
//
// That is not a bug in one link. It is what happens when N controls each
// re-derive the URL from the subset of state their author happened to be
// holding. The fix is that there is now exactly one place where a /market URL
// is made, it starts from the CURRENT state, and a control may change only its
// own parameter.
//
// DEFAULTS ARE OMITTED so canonical URLs stay clean: /market rather than
// /market?tab=lines&view=cards&sort=game. The default VIEW depends on the tab -
// props defaults to the table, lines and futures default to their cards - which
// is why omission has to be computed against the merged state rather than a
// constant.

/** Every parameter the page reads, in the order a URL should carry them. */
export const PARAMS = ['tab', 'view', 'f', 'g', 'game', 'sort', 'dir', 'q', 'board', 'movers'];

export const DEFAULT_TAB = 'lines';

/** The unmarked view for a tab. Props reads as a table; the others as cards. */
export function defaultView(tab) {
  return tab === 'props' ? 'table' : 'cards';
}

/** The unmarked sort for a tab+view. */
export function defaultSort(tab, view) {
  if (tab === 'props') return 'move';
  if (tab === 'futures') return 'implied';
  if (tab === 'lines' && view === 'table') return 'game';
  return 'move';
}

/**
 * Which columns read better ascending. Shared by every table so a header's
 * first click means the same thing wherever it is.
 */
const ASC_FIRST = new Set(['player', 'game', 'market', 'selection', 'lg', 'team']);

/**
 * THE DIRECTION TOGGLE, in the helper rather than in three components.
 *
 * Clicking the ACTIVE column flips it. Clicking a NEW column takes that
 * column's sensible default - names ascending, magnitudes descending - because
 * a reader sorting by price wants the extreme, and a reader sorting by player
 * wants the alphabet.
 */
export function nextDir(column, currentSort, currentDir) {
  if (column !== currentSort) return ASC_FIRST.has(column) ? 'asc' : 'desc';
  const effective = currentDir ?? (ASC_FIRST.has(column) ? 'asc' : 'desc');
  return effective === 'desc' ? 'asc' : 'desc';
}

/**
 * Build a /market URL from the CURRENT state plus a patch.
 *
 * @param current  the page's parsed state - every key in PARAMS
 * @param patch    only the params this control owns; null removes one
 *
 * A control passes ONLY what it changes. Everything else survives by
 * construction rather than by each caller remembering to thread it.
 */
export function marketHref(current = {}, patch = {}) {
  const next = { ...current, ...patch };

  const tab = next.tab || DEFAULT_TAB;
  // A VIEW BELONGS TO ITS TAB. Carrying ?view=charts onto FUTURES would name a
  // view that tab does not have, so a tab change that does not also name a
  // view drops it back to that tab's default.
  const tabChanged = patch.tab != null && patch.tab !== current.tab;
  const view = patch.view !== undefined ? patch.view : (tabChanged ? null : next.view);
  // Same for sort: 'hit' means nothing on the futures table, so a tab change
  // resets the ordering rather than carrying a column that does not exist.
  const sort = patch.sort !== undefined ? patch.sort : (tabChanged ? null : next.sort);
  const dir = patch.dir !== undefined ? patch.dir : (tabChanged ? null : next.dir);

  const merged = { ...next, tab, view, sort, dir };
  const qs = [];
  for (const key of PARAMS) {
    const v = merged[key];
    if (v == null || v === '' || v === false) continue;
    if (key === 'tab' && v === DEFAULT_TAB) continue;
    if (key === 'view' && v === defaultView(tab)) continue;
    if (key === 'sort' && v === defaultSort(tab, view ?? defaultView(tab))) continue;
    if ((key === 'f' || key === 'g') && v === 'all') continue;
    if ((key === 'board' || key === 'movers') && v !== '1' && v !== true) continue;
    qs.push(`${key}=${encodeURIComponent(v === true ? '1' : v)}`);
  }
  return qs.length ? `/market?${qs.join('&')}` : '/market';
}

/**
 * The hidden inputs a GET form needs so submitting it preserves everything the
 * form does not itself own. A form posts ONLY its named fields, so any param
 * missing here is a param the reader silently loses on submit - the same class
 * of loss as a hand-built href, arriving through a different door.
 */
export function hiddenFields(current = {}, owned = []) {
  const out = [];
  const tab = current.tab || DEFAULT_TAB;
  for (const key of PARAMS) {
    if (owned.includes(key)) continue;
    const v = current[key];
    if (v == null || v === '' || v === false) continue;
    if (key === 'tab' && v === DEFAULT_TAB) continue;
    if (key === 'view' && v === defaultView(tab)) continue;
    if (key === 'sort' && v === defaultSort(tab, current.view ?? defaultView(tab))) continue;
    if ((key === 'f' || key === 'g') && v === 'all') continue;
    out.push([key, v === true ? '1' : String(v)]);
  }
  return out;
}
