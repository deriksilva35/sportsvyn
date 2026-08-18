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
];

// A postal address is required by CAN-SPAM in every commercial message. From the
// environment because it is a real-world fact about the business, not a
// constant, and because a placeholder committed to the repo WOULD get sent.
const POSTAL = process.env.EMAIL_POSTAL_ADDRESS || null;

// ---------------------------------------------------------------------------
// THE COPY. Approved verbatim 18 Aug, except the CTA target - see CTA_URL.
// ---------------------------------------------------------------------------
//
// HYPHENS ONLY. House rule, and it is asserted rather than trusted: an em dash
// pasted in from a document renders as a different character in a mail client
// than it does in a terminal, and nobody proofreads the HTML part. assertHyphens
// below refuses to send if one survives into either rendering.
const SUBJECT = 'Draftvyn is now completely free.';

/**
 * WHERE "START A DRAFT" POINTS.
 *
 * The approved copy said draftvyn.com. THAT DOMAIN DOES NOT RESOLVE - checked
 * before wiring it: DNS failure on both draftvyn.com and www.draftvyn.com,
 * while sportsvyn.com answers 200. A dead link is the one defect a broadcast
 * cannot walk back, so this points at the page the button actually names.
 *
 * If draftvyn.com is registered and pointed later, this is the one line to
 * change - and it should change, because the app is Draftvyn and the domain
 * matching the brand is worth having.
 */
const CTA_URL = 'https://sportsvyn.com/sim';
const CTA_LABEL = 'START A DRAFT';

const BODY_LINES = [
  'The paywall is gone - all of it. Every mock draft, unlimited. The Tracker for '
  + 'your real draft night. Superflex, 14 and 16-team rooms, custom league setups. '
  + 'Everything Draftvyn does is now free for the 2026 season.',

  'Get your reps in: full snake drafts against AI rooms that reach and slide, every '
  + 'pick graded on live ADP. Then bring the Tracker to draft night and keep '
  + 'best-available and your roster in front of you the whole time.',

  'One more thing - Draftvyn is now more than draft prep. The Daily is live: 64 real '
  + "performances from one hidden week of NFL history, three minutes to build your "
  + "best six, new board every midnight. Pick 'em opens Aug 25, and two more games "
  + 'land with Week 1.',

  'Your draft is coming.',
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
    ...BODY_LINES,
    '',
    `${CTA_LABEL}: ${CTA_URL}`,
    '',
    '---',
    `Unsubscribe: ${unsubscribeUrl}`,
    postal,
  ].join('\n\n');

  // ==========================================================================
  // BULLETPROOF-DARK, after Spark stripped the first draft to white-on-white
  // ==========================================================================
  // The first HTML put the background on <body> and the CTA on a styled <a>.
  // Apple Mail rendered it perfectly; Spark desktop stripped the body style,
  // leaving near-white text on a white page and the button degraded to
  // underlined text. Body styles are the FIRST thing clients strip, so:
  //
  //   - the background lives on a wrapper TABLE CELL, twice: bgcolor="" (the
  //     HTML attribute - survives style-stripping) AND inline background-color
  //     (wins where both are honoured). <body> carries it too, as a third coat,
  //     not as the load-bearing one.
  //   - EVERY text element declares its own inline color. Nothing inherits,
  //     because inheritance is only as strong as the ancestor that gets kept.
  //   - the CTA is a table cell with bgcolor + padding, wrapping an <a> that
  //     carries its own color and no underline. A cell with a background
  //     attribute is the one button construction every client leaves alone.
  //
  // Kept DARK by ruling (it is the brand). The pass bar in Spark is LEGIBLE,
  // not pixel-perfect: if a client still forces white, the bgcolor attribute is
  // what it honours, and if it strips even that, the per-element colors go down
  // with the background rather than one surviving without the other.
  const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = '<!doctype html><html><head><meta name="color-scheme" content="dark">'
    + '<meta name="supported-color-schemes" content="dark"></head>'
    + '<body style="margin:0;padding:0;background-color:#0A0A0A;" bgcolor="#0A0A0A">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
    + 'bgcolor="#0A0A0A" style="background-color:#0A0A0A;"><tr>'
    + '<td align="center" bgcolor="#0A0A0A" style="background-color:#0A0A0A;padding:24px;">'
    + '<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" '
    + 'style="max-width:520px;width:100%;"><tr><td>'
    + `<div style="font-family:${F};font-size:10px;font-weight:700;letter-spacing:.28em;`
    + 'text-transform:uppercase;color:#D4FF00;margin:0 0 18px;">Draftvyn</div>'
    + BODY_LINES.map((l) =>
      `<p style="font-family:${F};font-size:15px;line-height:1.6;color:#F5F5F2;margin:0 0 14px;">${l}</p>`).join('')
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr>'
    + '<td bgcolor="#D4FF00" style="background-color:#D4FF00;border-radius:8px;">'
    + `<a href="${CTA_URL}" style="display:inline-block;font-family:${F};color:#0A0A0A;`
    + 'text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.06em;'
    + `padding:13px 22px;">${CTA_LABEL}</a>`
    + '</td></tr></table>'
    + '<hr style="border:0;border-top:1px solid #232323;margin:24px 0;">'
    + `<p style="font-family:${F};font-size:12px;color:#8A8A86;line-height:1.6;margin:0;">`
    + `<a href="${unsubscribeUrl}" style="color:#8A8A86;">Unsubscribe</a><br>`
    + `<span style="color:#8A8A86;">${postal}</span>`
    + '</p></td></tr></table></td></tr></table></body></html>';

  assertHyphens(SUBJECT, text, html);
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
  console.log(`\n  sent ${sent} · skipped ${skipped} (already sent) · failed ${failed}\n`);
}

await main();
