// lib/survivor/flag.js - Survivor is pulled from the product (thu-27, 1 Oct 2026).
//
// OFF UNLESS SURVIVOR=on. Derik is rethinking it alongside the pick-once engine
// and leagues; nothing is deleted - migration 118, the tables, the national
// pool row, this code and its tests all stay. With the flag off: /survivor
// 404s, the /games row is gone, the pick action refuses, and the grading cron
// is unscheduled in vercel.json (its route stays, Bearer-gated). PURE.
export const survivorOn = (env = process.env) => String(env?.SURVIVOR ?? '').trim().toLowerCase() === 'on';
