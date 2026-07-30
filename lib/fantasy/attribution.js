// lib/fantasy/attribution.js — the FFC attribution string, alone in a module with
// NO imports so BOTH server and client surfaces can single-source it.
//
//   ┌───────────────────────────────────────────────────────────────────────┐
//   │ ATTRIBUTION (REQUIRED): any surface that renders FFC ADP data MUST      │
//   │ show "ADP data courtesy of Fantasy Football Calculator" linking to      │
//   │ https://fantasyfootballcalculator.com/ . It is a condition of the free  │
//   │ commercial license — see lib/fantasy/ffc.js.                            │
//   └───────────────────────────────────────────────────────────────────────┘
//
// This lives apart from ffc.js because ffc.js imports lib/db.js (the Neon
// client). A 'use client' surface that needs the licensed string — the sim setup
// screen's one-viewport credit — cannot import ffc.js without dragging the DB
// driver into the browser bundle. Splitting the constant out means the string has
// exactly ONE definition for every surface, which is the whole point: a second
// hand-typed copy is a copy that drifts out of compliance.
//
// ffc.js re-exports FFC_ATTRIBUTION, so existing server importers are unchanged.

export const FFC_ATTRIBUTION = {
  text: 'ADP data courtesy of Fantasy Football Calculator',
  url: 'https://fantasyfootballcalculator.com/',
  // Bare host for the compact/mobile register, where the full URL would wrap.
  host: 'fantasyfootballcalculator.com',
};
