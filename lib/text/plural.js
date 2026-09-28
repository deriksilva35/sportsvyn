// lib/text/plural.js - "1 game", "2 games". The one pluraliser.
//
// "1 games" shipped on the rebrand preview because every count in the product
// hand-rolled its own noun, and the ones written as `${n} games` were only ever
// read with a slate of more than one. A count and its noun are one decision;
// this makes it in one place. English only, regular plurals by default, an
// irregular one passed as the third argument.

/** The noun alone: plural(1, 'game') -> 'game', plural(3, 'game') -> 'games'. */
export function noun(n, one, many = `${one}s`) {
  return Number(n) === 1 ? one : many;
}

/** The count and the noun: plural(1, 'game') -> '1 game'. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${noun(n, one, many)}`;
}
