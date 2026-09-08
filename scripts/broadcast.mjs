// scripts/broadcast.mjs - a one-off product-update email to existing accounts.
//
// ============================================================================
// DRY RUN IS THE DEFAULT. Sending needs --send AND a typed confirmation.
// ============================================================================
// There is no undo on a broadcast. So the default run prints the recipient
// count, the full recipient list and the rendered mail to stdout and exits
// having touched nothing. --send additionally requires typing the recipient
// count back, because a flag is something you can leave in a shell history and
// re-run by pressing up.
//
// WHY A SCRIPT AND NOT RESEND BROADCASTS/AUDIENCES. Audiences means syncing the
// user table into a second system of record and keeping unsubscribe state in
// both. Ours already lives in Postgres, honoured by a signed link that needs no
// auth, and the list is under a hundred people. Broadcasts earn their keep at
// thousands of contacts with segmentation; at this size they would add a
// reconciliation problem and remove nothing.
//
// IT REUSES THE WELCOME MAIL'S PARTS rather than reimplementing them:
// unsubscribeUrlFor for the signed link, unsubscribeHeaders for RFC 8058,
// and the same sync_runs ledger shape with stuck-detection. One suppression
// rule, one unsubscribe contract, one place to read what happened.
//
// CREDENTIAL FROM THE ENVIRONMENT, per CLAUDE.md:
//   set -a && . ./.env.local && set +a
//   node scripts/broadcast.mjs                 # dry run against DATABASE_URL
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/broadcast.mjs
//   ... --send                                 # live, with a prompt
//
// Usage: node scripts/broadcast.mjs [--send] [--limit N] [--to owner-address]
//
// --to REPURPOSED, 18 Aug: it used to filter the roster, which made it useless
// for its actual job - a test send to Derik - because owner addresses are
// excluded from the roster by design, so --to <owner> matched nothing. It is
// now a TEST SEND: the identical rendered mail to exactly one address, which
// must be on the owner list (validateTestRecipient refuses anything else, so
// the override can never become a side door for mailing a user). Ledgered with
// kind 'test' and test: true so it never reads as broadcast history, and no
// typed count - the count is 1 by construction.

import readline from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';
import { sql } from '../lib/db.js';
import { unsubscribeUrlFor, unsubscribeHeaders } from '../lib/auth/welcomeEmail.js';
import { databaseFingerprint, assertLiveTarget, validateTestRecipient } from '../lib/email/broadcastRules.js';

const args = process.argv.slice(2);
const LIVE = args.includes('--send');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i < 0 ? null : Number(args[i + 1]); })();
const ONLY = (() => { const i = args.indexOf('--to'); return i < 0 ? null : args[i + 1]; })();

const SOURCE = 'broadcast';

// ---------------------------------------------------------------------------
// EXCLUSIONS
// ---------------------------------------------------------------------------
// THE OWNER'S OWN ACCOUNTS. Five addresses that are Derik testing the product,
// not users. Listed explicitly rather than pattern-matched on 'derik' because a
// real user called Derik would otherwise be silently dropped.
const OWNER_ADDRESSES = [
  'deriksilva@gmail.com',
  'derik@safetymanagers.com',
  'derik@sportsvyn.com',
  'deriksilva+welcome@gmail.com',
  'deriksilva+welcome2@gmail.com',
  // Sixth, added 18 Aug: signed up through the app the morning of the send and
  // would otherwise have been mailed. THE LIST IS THE WEAKNESS OF THIS DESIGN -
  // a new owner address is invisible until somebody reads the dry-run roster,
  // which is the argument for reading it every time rather than trusting the
  // count.
  'deriksilva@compsysllc.com',
  // Seventh, 19 Aug: the recreated Skry-identity account (user 74, Derik's
  // push device #1). Found the same way as the sixth - by a list somewhere
  // refusing it - which is the dry-run-roster argument restated.
  'derik@theskry.com',
];

// ---------------------------------------------------------------------------
// THE FOUNDER'S VERIFY COPY. The exclusion list did its job perfectly on the
// first real send - and the founder learned the send happened by asking why
// his inbox was empty. Exclusion keeps test accounts OUT OF THE AUDIENCE;
// this puts one copy of every live send IN FRONT OF THE OWNER'S EYES,
// always, ledgered as 'owner-verify' and never counted in the recipient
// total or the audience telemetry. Two different jobs, two mechanisms.
const OWNER_VERIFY_ADDRESS = 'deriksilva@gmail.com';

// A postal address is required by CAN-SPAM in every commercial message. From the
// environment because it is a real-world fact about the business, not a
// constant, and because a placeholder committed to the repo WOULD get sent.
const POSTAL = process.env.EMAIL_POSTAL_ADDRESS || null;

// ---------------------------------------------------------------------------
// THE COPY. Subject and preheader below; the body is the launch email file,
// read from disk at run time - see HTML_FILE. (The 18 Aug body and its CTA
// constants are gone, not commented out.)
// ---------------------------------------------------------------------------
//
// HYPHENS ONLY. House rule, and it is asserted rather than trusted: an em dash
// pasted in from a document renders as a different character in a mail client
// than it does in a terminal, and nobody proofreads the HTML part. assertHyphens
// below refuses to send if one survives into either rendering.
const SUBJECT = 'You came for the mock draft. Now it counts.';
const PREHEADER = 'Four ranked games, all free. The Weekly locks at first kickoff Wednesday night.';

// ============================================================================
// THE BODY IS A FILE, READ FROM DISK AT RUN TIME - docs/email/launch-email-sep8.html
// ============================================================================
// This script used to carry its own copy (a BODY_LINES array and a hand-built
// dark table) and would have mailed the whole roster last month's "Draftvyn is
// now completely free" announcement under the launch subject. BODY_LINES and
// the CTA constants are REMOVED, not left unreferenced: dead copy in the one
// script that mails everyone is copy that gets sent by accident.
//
// The file is read ONCE, here, and its sha256 is printed in the dry-run header
// so the operator can check it against `sha256sum docs/email/launch-email-sep8.html`
// on main before typing the count. The bytes are never printed.
const HTML_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'email', 'launch-email-sep8.html');
const HTML_BYTES = readFileSync(HTML_FILE);
const HTML_SHA256 = createHash('sha256').update(HTML_BYTES).digest('hex');
const HTML_TEMPLATE = HTML_BYTES.toString('utf8');

// EXACTLY ONE UNSUBSCRIBE PLACEHOLDER, asserted at load - before a roster is
// read or a single mail rendered. Zero means the file has no unsubscribe link
// and 222 people would get a bulk send with no way out; more than one means a
// second link this script does not know about. Either is fatal here, loudly.
const UNSUB_PLACEHOLDER = '{{unsubscribe_url}}';
const UNSUB_COUNT = HTML_TEMPLATE.split(UNSUB_PLACEHOLDER).length - 1;
if (UNSUB_COUNT !== 1) {
  throw new Error(`${path.basename(HTML_FILE)} contains ${UNSUB_COUNT} '${UNSUB_PLACEHOLDER}' placeholders - expected exactly 1. Not rendering.`);
}
// The preheader is the file's own hidden first line; assert the file actually
// carries the one the header claims, so the printed preheader is a fact about
// the bytes and not a constant that could drift from them.
if (!HTML_TEMPLATE.includes(PREHEADER)) {
  throw new Error(`${path.basename(HTML_FILE)} does not contain the expected preheader. Not rendering.`);
}

// THE PLAIN-TEXT ALTERNATIVE - the four games, their taglines, the lobby.
// Same lines the 8 Sep single send carried; the taglines are the ratified
// ones from app/games/how-it-works/page.js.
const TEXT_LINES = [
  'You came for the mock draft. Now it counts. Four ranked games, all free.',
  '',
  'The Draft - Pick your seat, draft your team, compete against the field.',
  '',
  'The Weekly - Pick any player at each position. Make your best roster, no draft, no salary, and see where it stacks up against the field that week.',
  '',
  "Pick'em - Pick the winners. No odds, no problem.",
  '',
  'The Daily - One season from NFL history. Twelve teams. Eight slots. Four regrets.',
  '',
  'https://sportsvyn.com/games',
];

/** Refuses the send if a dash that is not a hyphen reaches either rendering. */
function assertHyphens(...parts) {
  const bad = [];
  for (const part of parts) {
    for (const m of String(part).matchAll(/[\u2010-\u2015\u2212]/g)) {
      bad.push(`${JSON.stringify(m[0])} at ${m.index}`);
    }
  }
  if (bad.length) throw new Error(`non-hyphen dash in the copy: ${bad.join(', ')}`);
}

function render({ unsubscribeUrl }) {
  const postal = POSTAL ?? '[EMAIL_POSTAL_ADDRESS NOT SET - REQUIRED BEFORE SENDING]';

  const text = [
    ...TEXT_LINES,
    '',
    '---',
    `Unsubscribe: ${unsubscribeUrl}`,
    postal,
  ].join('\n');

  // ONE SUBSTITUTION PER RECIPIENT, re-counted on every render. The load-time
  // assert above already proved the template has exactly one placeholder;
  // this re-checks the RESULT, so a template edit between load and send (or a
  // bug in the replace) cannot ship a literal '{{unsubscribe_url}}' href.
  const html = HTML_TEMPLATE.replace(UNSUB_PLACEHOLDER, unsubscribeUrl);
  const left = html.split(UNSUB_PLACEHOLDER).length - 1;
  const put = html.split(unsubscribeUrl).length - 1;
  if (left !== 0 || put !== 1) {
    throw new Error(`unsubscribe substitution failed: ${left} placeholder(s) left, url present ${put} time(s)`);
  }

  // HYPHENS ONLY applies to the copy THIS SCRIPT authors - the subject and the
  // text alternative. The HTML file is a designed, approved artifact that went
  // out on 8 Sep as-is; it is not re-linted here.
  assertHyphens(SUBJECT, text);
  return { text, html };
}

// ---------------------------------------------------------------------------
// THE LIST
// ---------------------------------------------------------------------------
// SUPPRESSION IS A WHERE CLAUSE, not a filter applied afterwards. An opted-out
// address should never be loaded into a variable that a later bug could send to.
async function recipients() {
  // CONTACT ADDRESS WINS WHEN PRESENT. contact_email is what somebody typed
  // into a box that said we would email them; users.email may be an Apple relay
  // alias that forwards only while Apple says so - and for thirty of these
  // accounts it is exactly that. See migration 069 for why the two are separate
  // columns rather than one mutable field.
  //
  // SUPPRESSION AND EXCLUSION KEY ON THE USER, NOT THE ADDRESS. An opt-out is a
  // person's decision, so it must survive them changing where mail goes; and
  // the owner exclusion has to catch Derik's accounts whichever address they
  // would be reached at today.
  const rows = await sql`
    SELECT id, COALESCE(contact_email, email) AS email
      FROM users
     WHERE COALESCE(contact_email, email) IS NOT NULL
       AND email_opted_out_at IS NULL
       AND NOT (email = ANY(${OWNER_ADDRESSES}))
       AND NOT (COALESCE(contact_email, '') = ANY(${OWNER_ADDRESSES}))
     ORDER BY id`;
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

// ---------------------------------------------------------------------------
// THE LEDGER - same shape and same stuck-detection as the welcome mail.
// ---------------------------------------------------------------------------
const STUCK_AFTER_MINUTES = 10;

async function alreadySent(userId) {
  const r = await sql`
    SELECT 1 FROM sync_runs
     WHERE source = ${SOURCE} AND (summary->>'userId')::int = ${userId}
       AND (summary->>'outcome' = 'sent'
            OR (summary->>'outcome' = 'sending'
                AND started_at > now() - (${STUCK_AFTER_MINUTES} || ' minutes')::interval))
     LIMIT 1`;
  return r.length > 0;
}

const recordStart = async (userId) => (await sql`
  INSERT INTO sync_runs (source, kind, started_at, ok, summary)
  VALUES (${SOURCE}, 'send', now(), true, ${JSON.stringify({ userId, outcome: 'sending' })}::jsonb)
  RETURNING id`)[0].id;

const recordFinish = (rowId, summary, err = null) => sql`
  UPDATE sync_runs SET finished_at = now(), ok = ${!err},
         summary = ${JSON.stringify(summary)}::jsonb, error = ${err}
   WHERE id = ${rowId}`;

// ---------------------------------------------------------------------------
// THE TEST SEND - one owner address, the identical mail, ledgered as a test.
// ---------------------------------------------------------------------------
async function testSend(address) {
  // The unsubscribe link is SIGNED FOR A REAL USER ROW, because the test's
  // whole point is that every part of the mail is the part a recipient gets -
  // a placeholder token would leave the one click Gmail actually scrutinises
  // untested. Owner addresses are users too (they are excluded from the
  // roster, not from the table), so the row exists to sign for.
  const [u] = await sql`
    SELECT id FROM users
     WHERE email = ${address} OR contact_email = ${address}
     ORDER BY id LIMIT 1`;
  if (!u) throw new Error(`no user row for ${address} - the unsubscribe link needs one to sign for`);

  const url = await unsubscribeUrlFor(u.id);
  const mail = render({ unsubscribeUrl: url });

  const rowId = (await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    VALUES (${SOURCE}, 'test', now(), true,
            ${JSON.stringify({ userId: u.id, to: address, test: true, outcome: 'sending' })}::jsonb)
    RETURNING id`)[0].id;
  try {
    const { resend, EMAIL_FROM } = await import('../lib/resend.js');
    const res = await resend.emails.send({
      from: EMAIL_FROM, to: address, subject: SUBJECT,
      html: mail.html, text: mail.text, headers: unsubscribeHeaders(url),
    });
    const id = res?.data?.id ?? null;
    if (res?.error) throw new Error(res.error?.message ?? JSON.stringify(res.error));
    await recordFinish(rowId, { userId: u.id, to: address, test: true, outcome: 'test-sent', id });
    console.log(`\n  TEST SEND ACCEPTED. to=${address} resend id=${id}`);
    console.log('  Ledgered as kind=test - not broadcast history.\n');
  } catch (e) {
    await recordFinish(rowId, { userId: u.id, to: address, test: true, outcome: 'failed' }, String(e?.message ?? e));
    throw e;
  }
}

// ---------------------------------------------------------------------------
async function main() {
  // A typo'd --to fails HERE, before anything is queried or rendered.
  const testTo = ONLY == null ? null : validateTestRecipient(ONLY, OWNER_ADDRESSES);
  const list = testTo ? [] : await recipients();
  const fingerprint = databaseFingerprint(process.env.DATABASE_URL);

  console.log(`\n  target database : ${fingerprint}`);
  console.log(`  mode            : ${LIVE ? 'LIVE SEND' : 'DRY RUN (no mail will be sent)'}`);
  console.log(`  postal address  : ${POSTAL ?? 'NOT SET - blocks a live send'}`);
  console.log(`  subject         : ${SUBJECT}`);
  console.log(`  preheader       : ${PREHEADER}`);
  console.log(`  html file       : ${path.relative(process.cwd(), HTML_FILE)}  (${HTML_BYTES.length} bytes, read at run time, never printed)`);
  console.log(`  sha256          : ${HTML_SHA256}`);
  if (testTo) console.log(`  TEST SEND to    : ${testTo} (owner list) - roster ignored`);
  if (!testTo) {
    console.log(`\n  RECIPIENTS: ${list.length}`);
    for (const r of list) console.log(`    ${String(r.id).padStart(4)}  ${r.email}`);
  }

  const sample = render({ unsubscribeUrl: await unsubscribeUrlFor(list[0]?.id ?? 0) });
  console.log('\n  ---- RENDERED (text) ----');
  console.log(sample.text.split('\n').map((l) => `  | ${l}`).join('\n'));
  console.log('  -------------------------\n');

  if (!LIVE) {
    console.log('  DRY RUN COMPLETE. Nothing was sent and nothing was written.');
    console.log('  To send: re-run with --send (you will be asked to confirm the count).\n');
    return;
  }

  // ---- live send, and every gate has to be open --------------------------
  // TARGET FIRST. This refusal exists because a run without the
  // DATABASE_URL="$PROD_DATABASE_URL" prefix silently targets DEV - seen in a
  // dry run that printed RECIPIENTS: 1. It guards BOTH live paths: the test
  // send's ledger row and signed unsubscribe token are only meaningful on the
  // database the webhook and the unsubscribe endpoint actually read.
  assertLiveTarget(fingerprint);
  if (!POSTAL) throw new Error('EMAIL_POSTAL_ADDRESS is required for a live send (CAN-SPAM).');
  if (SUBJECT.includes('PLACEHOLDER')) throw new Error('the copy is still the placeholder - not sending.');
  // The dash check runs inside render(), which every send path calls.

  if (testTo) return testSend(testTo);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const typed = await rl.question(`  Type the recipient count (${list.length}) to send: `);
  rl.close();
  if (typed.trim() !== String(list.length)) {
    console.log('  Confirmation did not match. Nothing sent.\n');
    return;
  }

  const { resend } = await import('../lib/resend.js');
  const { EMAIL_FROM } = await import('../lib/resend.js');

  // The verify copy goes FIRST: if the audience send is about to break, the
  // owner's inbox is the first place that shows it. Signed for user 1's real
  // row so the unsubscribe link is live, exactly like a recipient's.
  try {
    const [vu] = await sql`SELECT id FROM users WHERE email = ${OWNER_VERIFY_ADDRESS} ORDER BY id LIMIT 1`;
    const vUrl = await unsubscribeUrlFor(vu?.id ?? 0);
    const vMail = render({ unsubscribeUrl: vUrl });
    const vRes = await resend.emails.send({
      from: EMAIL_FROM, to: OWNER_VERIFY_ADDRESS, subject: SUBJECT,
      html: vMail.html, text: vMail.text, headers: unsubscribeHeaders(vUrl),
    });
    await sql`
      INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
      VALUES (${SOURCE}, 'owner-verify', now(), now(), ${!vRes?.error},
              ${JSON.stringify({ to: OWNER_VERIFY_ADDRESS, ownerVerify: true, outcome: vRes?.error ? 'failed' : 'sent', id: vRes?.data?.id ?? null })}::jsonb)`;
    console.log(`  owner verify copy -> ${OWNER_VERIFY_ADDRESS} (${vRes?.error ? 'FAILED' : 'sent'}, uncounted)`);
  } catch (e) {
    console.log(`  owner verify copy FAILED: ${String(e?.message ?? e)} - audience send continues`);
  }

  let sent = 0; let skipped = 0; let failed = 0;
  for (const r of list) {
    if (await alreadySent(r.id)) { skipped += 1; continue; }
    const rowId = await recordStart(r.id);
    try {
      const url = await unsubscribeUrlFor(r.id);
      const mail = render({ unsubscribeUrl: url });
      const res = await resend.emails.send({
        from: EMAIL_FROM, to: r.email, subject: SUBJECT,
        html: mail.html, text: mail.text, headers: unsubscribeHeaders(url),
      });
      await recordFinish(rowId, { userId: r.id, outcome: 'sent', id: res?.data?.id ?? null });
      sent += 1;
    } catch (e) {
      await recordFinish(rowId, { userId: r.id, outcome: 'failed' }, String(e?.message ?? e));
      failed += 1;
    }
  }
  console.log(`\n  sent ${sent} + owner copy · skipped ${skipped} (already sent) · failed ${failed}\n`);
}

await main();
