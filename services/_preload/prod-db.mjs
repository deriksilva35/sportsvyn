// services/_preload/prod-db.mjs — the ONE mechanism that points a droplet
// service at PROD before anything else can import lib/db.js.
//
// LOADED VIA `node --import`, NOT AN IN-FILE ASSIGNMENT. An assignment at the
// top of an entrypoint (`process.env.DATABASE_URL = process.env.
// PROD_DATABASE_URL`) runs too late if ANYTHING in that same file is a
// static `import` - ES module imports are hoisted, so a transitively-
// imported lib/db.js can already have called `neon(process.env.DATABASE_URL)`
// against whatever DATABASE_URL held at process start, before the
// assignment's own line ever executes. `node --import <this file> <entry>`
// runs this module to completion, as its own separate load, before the
// entry module's imports resolve at all - there is no ordering race left to
// get wrong. This is the exact trap that left lib/wire/emit.js silently
// querying DEV from inside the live-poller process: its own index.mjs set
// PROD_DATABASE_URL into a LOCAL `sql` client, correctly, but never touched
// process.env.DATABASE_URL, so anything importing the SHARED lib/db.js
// (emit.js included) still saw whatever the environment file left there.
//
// EVERY DROPLET SERVICE USES THIS SAME PRELOAD, ONE MECHANISM NOT TWO.
// services/daily-tick/index.mjs used to do this itself, in-file, and by
// coincidence never actually hit the hoisting race (its own first static
// import already was the tick logic, not lib/db.js directly) - but "worked
// by coincidence" is not the same claim as "does the same thing every other
// service does," so it moves here too.

if (!process.env.PROD_DATABASE_URL) {
  console.error('[prod-db] PROD_DATABASE_URL missing in environment');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
console.log(`[prod-db] DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}`);
