// Post-tournament homepage copy. The champion is READ FROM THE BRACKET DATA
// (getTournamentChampion) and passed in — never hardcoded. Hyphens only, fitted
// to the existing serif register.

export function completedIntro(champion) {
  return `The 2026 World Cup is settled - ${champion} are champions. Read it now as a finished story: how the bracket broke, where it turned, and who answered.`;
}

export function completedSignpost(champion) {
  return `${champion} are champions. The full bracket, every match, every read - the tournament stays readable.`;
}
