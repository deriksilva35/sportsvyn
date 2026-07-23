/**
 * lib/pollers/seasonResolver.js — resolve the football "season year".
 *
 * A football season is named by the calendar year it opens in the fall and runs
 * into the following winter/spring. So July onward (month >= 7) belongs to the
 * current calendar year's season; January through June belongs to the PRIOR
 * year's season (its playoffs + offseason). Both NFL and CFB share this. UTC
 * month, to stay on the toUtc discipline.
 */

export function resolveSeasonYear(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12
  return month >= 7 ? year : year - 1;
}
