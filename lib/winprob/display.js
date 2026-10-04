// lib/winprob/display.js - WHERE A WIN PROBABILITY MAY BE SHOWN, AND HOW IT IS
// LABELLED. Two one-line registries, per sport, with no imports, so a client
// card, the game page and the poller all read the same switch.
//
//   DISPLAYED    may the sport put a number on a card / page at all. The
//                poller writes live_state.win_prob only where this is true.
//   CALIBRATING  does that number carry the CALIBRATING tag.
//
// RULINGS (Derik, relay sat-1, 3 Oct 2026):
//   NFL  displayed, NO tag - the model is shipped (nfl.json 1.0.0); the method
//        note below stands under it instead.
//   CFB  displayed, TAGGED - cfb.json 0.1.0 as shipped, still awaiting the
//        Mac's blind re-score (model/winprob/GATE-cfb.md). When the re-score
//        passes, the flip is ONE LINE: `cfb: false` in CALIBRATING below.
//        lib/winprob/display.test.mjs pins both maps, so the flip is a
//        deliberate edit to two lines (here and the pin), never a drift.
//
//   PHONE        may the PHONE surfaces carry the number - the Live Activity
//                (lib/push/liveActivityState.js) and the iOS widget feed
//                (lib/widget/shape.js, via winProbForPhone). Replaced the
//                WINPROB_PHONE env flag (sun-23), which was one switch for all
//                sports and set nowhere, so the phone showed none.
//                NFL on (Derik, sun-23). CFB off until its sealed blind
//                re-score passes (model/winprob/GATE-cfb.md); its flip is then
//                `cfb: true` here and in the pin, like CALIBRATING's.
//                A sport the web does not DISPLAY never reaches the phone,
//                whatever this map says.

export const DISPLAYED = Object.freeze({ nfl: true, cfb: true });
export const CALIBRATING = Object.freeze({ nfl: false, cfb: true });
export const PHONE = Object.freeze({ nfl: true, cfb: false });

/** The one-line method note under a win-probability module (sat-1, exact). */
export const WINPROB_METHOD_NOTE = 'Sportsvyn model · market prior + game state';

/** Is the sport's win probability displayed? Unknown sports: no. */
export const winProbDisplayed = (sport) => DISPLAYED[sport] === true;
/** Does the sport's displayed number carry the CALIBRATING tag? Unknown sports: no. */
export const winProbCalibrating = (sport) => CALIBRATING[sport] === true;
/** May a phone surface carry the sport's win probability? DISPLAYED and PHONE both. */
export const winProbOnPhone = (sport) => DISPLAYED[sport] === true && PHONE[sport] === true;
