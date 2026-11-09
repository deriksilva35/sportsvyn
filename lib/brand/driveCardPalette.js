// lib/brand/driveCardPalette.js - the live drive card's field colours.
//
// ONE PLACE, EXEMPT FROM THE HEX CENSUS (lib/brand/ is colour DATA, not theme):
// these are the approved mock's own field-diagram colours (drive-2, "Live drive
// card"), the same on every theme because they say football things - blue is the
// line of scrimmage, yellow is the first down - not brand things. Team end-zone
// colours are data too and come from teams.color_primary, never from here.
export const DRIVE_PALETTE = Object.freeze({
  field: '#272567',       // the turf
  yardLine: '#3E3C86',
  yardLabel: '#8E8CC4',
  los: '#5AA9FF',         // line of scrimmage
  firstDown: '#FFD400',   // line to gain
  ball: '#D4FF00',        // volt
  ballRing: '#1C1A55',    // the card's navy
  redZone: '#E0185C',
  navy: '#1A1650',        // ink on volt
  white: '#FFFFFF',
  zoneFallback: '#4A4890',
});
