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
// Usage: node scripts/broadcast.mjs [--send] [--limit N] [--to email]

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { sql } from '../lib/db.js';
import { unsubscribeUrlFor, unsubscribeHeaders } from '../lib/auth/welcomeEmail.js';

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

  const html = '<!doctype html><html><body style="margin:0;background:#0A0A0A;color:#F5F5F2;'
    + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:24px;\">"
    + '<div style="max-width:520px;margin:0 auto;">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;'
    + 'color:#D4FF00;margin-bottom:18px;">Draftvyn</div>'
    + BODY_LINES.map((l) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${l}</p>`).join('')
    + `<p style="margin:24px 0;"><a href="${CTA_URL}" style="display:inline-block;background:#D4FF00;`
    + `color:#0A0A0A;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.06em;`
    + `padding:13px 22px;border-radius:8px;">${CTA_LABEL}</a></p>`
    + '<hr style="border:0;border-top:1px solid #232323;margin:24px 0;">'
    + '<p style="font-size:12px;color:#8A8A86;line-height:1.6;margin:0;">'
    + `<a href="${unsubscribeUrl}" style="color:#8A8A86;">Unsubscribe</a><br>${postal}`
    + '</p></div></body></html>';

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
  const filtered = ONLY ? rows.filter((r) => r.email === ONLY) : rows;
  return LIMIT ? filtered.slice(0, LIMIT) : filtered;
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
async function main() {
  const list = await recipients();
  const fingerprint = String(process.env.DATABASE_URL || '').includes('winter-dawn') ? 'PROD' : 'DEV';

  console.log(`\n  target database : ${fingerprint}`);
  console.log(`  mode            : ${LIVE ? 'LIVE SEND' : 'DRY RUN (no mail will be sent)'}`);
  console.log(`  postal address  : ${POSTAL ?? 'NOT SET - blocks a live send'}`);
  console.log(`  subject         : ${SUBJECT}`);
  console.log(`\n  RECIPIENTS: ${list.length}`);
  for (const r of list) console.log(`    ${String(r.id).padStart(4)}  ${r.email}`);

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
  if (!POSTAL) throw new Error('EMAIL_POSTAL_ADDRESS is required for a live send (CAN-SPAM).');
  if (SUBJECT.includes('PLACEHOLDER')) throw new Error('the copy is still the placeholder - not sending.');
  // The dash check runs inside render(), which every send path calls.

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
