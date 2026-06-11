// scripts/insert-the-laws-article.mjs
//
// DEV-ONLY one-shot insert for "The Laws · WC 2026" editorial feature.
// Three rows in a single transaction:
//   1. tags (the-laws / series / storyline / WC league)
//   2. articles (essay / published / Derik Silva / WC league)
//   3. article_tags (junction)
//
// Body is the verbatim text supplied by the editor. Formatting:
//   · the two "-----" dividers are NOT in the source body below.
//   · "2026-27" is a plain hyphen (was an en dash in the prior copy).
//   · "SOURCES:" line is the last line of body for now; the reader route
//     (future) will style it as a distinct footer.
//
// Post-insert: scans the stored body for any '—' (em dash) or '–'
// (en dash) and reports counts. Aborts the transaction if any dash is
// found in the to-be-inserted body before write.
//
// Host-guard: refuses if DATABASE_URL hostname includes winter-dawn.
//
// Run:  node scripts/insert-the-laws-article.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
const { Client } = pkg;
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal(path.resolve(__dirname, '..', '.env.local'));

const DEV_URL = process.env.DATABASE_URL;
if (!DEV_URL) throw new Error('DATABASE_URL missing in .env.local');
if (new URL(DEV_URL).hostname.includes('winter-dawn')) {
  throw new Error('REFUSE: DATABASE_URL points at PROD. This is a DEV-only script.');
}
console.log('dev host:', new URL(DEV_URL).hostname);

const TAG = {
  slug: 'the-laws',
  name: 'The Laws',
  tag_type: 'series',
  tag_category: 'storyline',
};

const ARTICLE = {
  slug: '2026-world-cup-rules-the-laws',
  type: 'essay',
  status: 'published',
  author: 'Derik Silva',
  title: 'The 2026 World Cup is a rules experiment, and the experiment is mostly about time',
  subtitle: 'Eight changes arrive with the tournament. Strip away the noise and almost all of them point in one direction: getting the ball back in play and keeping it there.',
};

// Body — verbatim from the editor. Em/en dashes scanned below before insert.
const BODY = `## The war on dead time

Every World Cup tweaks something. A new ball, a fresh offside protocol, a cooling break when the host country is too hot to play in the afternoon. What lands in the United States, Canada and Mexico this summer is a different order of thing. It is the most aggressive single package of law changes the sport has put into a major tournament in the modern era.

The changes were approved at the 140th IFAB General Assembly, take effect in July, and roll into domestic seasons worldwide for 2026-27. The World Cup is simply where they go live first, which makes the tournament a laboratory of 104 matches over six weeks, watched by the entire planet. Pierluigi Collina, FIFA's head of refereeing, framed the project in plain terms: the governing bodies are trying, in his words, to "clean the game as much as possible."

That is the line worth holding onto, because the eight changes look scattered until you sort them. Five of them are a coordinated war on dead time. Two widen what the video assistant referee is allowed to touch. One speeds up offside. One changes how players are allowed to behave. And one, the one everyone will argue about, quietly turns a soccer match into something closer to four quarters than two halves.

The largest cluster is about the clock, and specifically about the minutes that vanish into nothing: the slow walk off after a substitution, the trainer jogging on to inspect a cramp that isn't there, the throw-in that takes fifteen seconds when a team is protecting a slender lead.

The substitution rule now puts a number on it. A player being replaced has 10 seconds to leave the field. Dawdle past that, and the team is punished where it hurts. The replacement cannot come on until the first stoppage after a full minute has elapsed following the restart. For up to a minute, then, the side that tried to waste time plays a man short. The rule has already been run in a friendly, Iceland against Japan, so it arrives at the tournament tested rather than theoretical.

The medical treatment change is the most consequential of the cluster, and the one carrying real risk. A player attended to on the pitch by medical staff must now leave the field and stay off for a minute. The intent is obvious: kill the routine where a player goes down, gets treatment, and pops straight back up the moment the opponent's momentum is broken. The tension is just as obvious. A rule that forces a genuinely hurt player to choose between honesty and a numerical disadvantage is a rule that quietly discourages reporting injuries. How referees apply the trigger, whether they wave the trainer on or ask the player if he needs help, will decide whether this reads as housekeeping or as a problem. It is the change to watch for unintended consequences.

The third piece is the smallest and may be the most visible: a limit of five seconds on throw-ins and goal kicks. Take too long over a throw and it goes to the other team. Take too long over a goal kick and the opponent gets a corner. It targets the most cynical stalling at the end of matches, and it will produce at least one bewildered turnover late in a match that swings a result before players adjust their instincts.

## VAR gets a wider remit

Two of the eight changes expand the video assistant referee's jurisdiction, and jurisdiction creep is always worth tracking, because every new category VAR can review is a new category of stoppage and doubt.

The first expansion lets VAR step in when a clear foul by the attacking team before the ball is in play leads directly to a goal, a penalty, or a disciplinary sanction. In practice that means the scrum at a corner, the blocking, holding and screening that attacking sides have weaponized, is now reviewable when it produces a goal. VAR can also intervene when a corner has been incorrectly awarded in the first place.

The second expansion is about fixing the referee's own errors. A second yellow card that was clearly wrong, and the red that followed it, can now be rescinded on review. And if a card goes to the wrong player through mistaken identity, VAR can correct it. There is a deliberate boundary here worth noting: the system can wave off a corner that should not have been given, but it will not be used to reverse a goal kick that should have been a corner. The asymmetry tells you something about how cautiously the lawmakers are widening the aperture. They want to undo clear injustices without inviting endless arguments over every restart.

## Offside, faster

Semi-automated offside technology is not new. It ran at the last World Cup. What changes is the timing of the decision. The assistant referee will now receive an audio alert when a player is more than 10 centimeters offside, and raise the flag then, rather than holding it down and letting the move play out before the call comes back.

The trade is speed for a particular kind of drama. Fans lose the breathless sequence where a goal is scored and then erased by a delayed flag. In return, attacks die earlier and cleaner, and the marginal offside calls measured to the frame, the ones that have frustrated everyone for three seasons, get resolved closer to real time. It is the most purely technical change of the eight, and probably the least controversial.

## Conduct: the mouth and the protest

Two disciplinary additions round out the package. A player who covers his mouth during a confrontation with an opponent can now be shown a red card. And a player who leaves the field to protest a referee's decision can be sent off as well.

The first traces directly to a Champions League incident in which Real Madrid's Vinícius Júnior accused Benfica's Gianluca Prestianni of directing a slur at him, an exchange made impossible to adjudicate because Prestianni's mouth was covered when he spoke. Prestianni was later banned, with the suspension extended to cover this tournament. The rule is narrow by design. It applies to moments of aggression, not to the routine sight of a player shielding his mouth while talking tactics with a teammate. It is a small change with a serious purpose: to make abuse on the field harder to hide behind a hand.

## The change that isn't about time

Which leaves the outlier, and the one that genuinely alters the shape of the sport. Every match at this World Cup, indoors or outdoors, cool evening or desert afternoon, regardless of conditions, will include a break of three minutes midway through each half, roughly around the 22nd minute. The time is added to stoppage. Functionally, the game is now played in four quarters.

Cooling breaks themselves are old news. Referees have called them for years when heat and humidity demanded it. What is new is that the stoppage is agreed in advance and universal rather than left to the official's judgment, and that it comes with a side effect borrowed straight from the sports of the host nations: coaches can use the break to talk to their players, tablets and laptops in hand. Soccer has never had a sanctioned coaching timeout during play. Now, twice a match, it does.

The implications run in two directions. Tactically, it hands managers a reset partway through each half that they have never been allowed, a chance to adjust a press or plug a leak without burning a substitution or waiting for halftime. The coach who exploits those four windows best gains an edge no previous World Cup manager has had. Commercially, the subtext is not subtle. Two guaranteed stoppages on national broadcasts per match are two new blocks of advertising inventory, in a tournament staged largely in the country that perfected the televised stoppage. The break is sold as hydration and player welfare. It is also, plainly, a structural concession to how the game is consumed in 2026.

## What it adds up to

Sort the eight and the picture is coherent, not chaotic. The cluster aimed at killing dead time is overdue, internally consistent, and likely to do exactly what it is meant to do, though the medical treatment rule deserves a wary eye, because the incentive it creates points somewhere no one wants to go. The VAR expansion is the slow, careful widening of a system that has never stopped widening. The offside change is a clean upgrade. The conduct rules are narrow and defensible.

And the hydration break is the one that will define how this tournament feels, the change that, more than any new ball or bracket, marks 2026 as the World Cup where soccer started keeping time like the sports around it. Whether that is a cleaner game or simply a more interrupted one is the question the next six weeks will answer, in front of the largest audience the experiment could possibly have.

SOURCES: IFAB (140th General Assembly); Associated Press / Tribune Content Agency; Yahoo Sports; Sports Illustrated; BBC; ESPN; The Athletic. Rule details reflect the package as confirmed ahead of the June 11 opener.`;

// Pre-insert dash scan — refuse if any em/en dash slipped through.
const emCount = (BODY.match(/—/g) ?? []).length;
const enCount = (BODY.match(/–/g) ?? []).length;
console.log(`\npre-insert dash scan: em=${emCount} en=${enCount}`);
if (emCount > 0 || enCount > 0) {
  throw new Error('REFUSE: body still contains em/en dashes. Fix the source string before insert.');
}
const titleEm = (ARTICLE.title.match(/—/g) ?? []).length + (ARTICLE.title.match(/–/g) ?? []).length;
const subEm   = (ARTICLE.subtitle.match(/—/g) ?? []).length + (ARTICLE.subtitle.match(/–/g) ?? []).length;
if (titleEm > 0 || subEm > 0) throw new Error('REFUSE: title or dek carries an em/en dash.');

const dev = neon(DEV_URL);
const client = new Client({ connectionString: DEV_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  // Pre-existence guards.
  const existingTag     = await dev`SELECT id FROM tags WHERE slug = ${TAG.slug} LIMIT 1`;
  const existingArticle = await dev`SELECT id FROM articles WHERE slug = ${ARTICLE.slug} LIMIT 1`;
  if (existingTag.length > 0)     throw new Error(`tag '${TAG.slug}' already exists (id=${existingTag[0].id}). Aborting.`);
  if (existingArticle.length > 0) throw new Error(`article '${ARTICLE.slug}' already exists (id=${existingArticle[0].id}). Aborting.`);

  const wcLeague = await dev`SELECT id FROM leagues WHERE slug = 'fifa-wc-2026' LIMIT 1`;
  if (wcLeague.length !== 1) throw new Error('WC league not found on DEV.');
  const leagueId = wcLeague[0].id;
  console.log('WC league_id:', leagueId);

  // Transactional 3-row insert.
  await client.query('BEGIN');

  const tagRes = await client.query(
    `INSERT INTO tags (slug, name, tag_type, tag_category, league_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, slug, name, tag_type, tag_category, league_id`,
    [TAG.slug, TAG.name, TAG.tag_type, TAG.tag_category, leagueId]
  );
  const tagId = tagRes.rows[0].id;

  const articleRes = await client.query(
    `INSERT INTO articles (
       slug, type, status, author,
       title, subtitle, body,
       league_id, match_id, team_ids, player_ids,
       published_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7,
       $8, NULL, '{}'::int[], '{}'::int[],
       now()
     )
     RETURNING id, slug, type, status, published_at`,
    [
      ARTICLE.slug, ARTICLE.type, ARTICLE.status, ARTICLE.author,
      ARTICLE.title, ARTICLE.subtitle, BODY,
      leagueId,
    ]
  );
  const articleId = articleRes.rows[0].id;

  const junctionRes = await client.query(
    `INSERT INTO article_tags (article_id, tag_id)
     VALUES ($1, $2)
     RETURNING article_id, tag_id`,
    [articleId, tagId]
  );

  await client.query('COMMIT');
  console.log('  ✓ COMMIT — 3 rows inserted.\n');

  // Verify-after.
  const stored = (await dev`SELECT id, slug, type, status, author, title, subtitle, body, published_at, league_id FROM articles WHERE id = ${articleId}`)[0];
  const storedTag = (await dev`SELECT * FROM tags WHERE id = ${tagId}`)[0];
  const storedJunction = (await dev`SELECT * FROM article_tags WHERE article_id = ${articleId} AND tag_id = ${tagId}`)[0];

  console.log('='.repeat(80));
  console.log('STORED IDS');
  console.log('='.repeat(80));
  console.log('  tags.id            :', tagId);
  console.log('  articles.id        :', articleId);
  console.log('  article_tags junction:', JSON.stringify(storedJunction));

  console.log('\n' + '='.repeat(80));
  console.log('POST-INSERT DASH SCAN (stored body)');
  console.log('='.repeat(80));
  const postEm = (stored.body.match(/—/g) ?? []).length;
  const postEn = (stored.body.match(/–/g) ?? []).length;
  console.log('  em dashes in stored body:', postEm, postEm === 0 ? '✓' : '✗');
  console.log('  en dashes in stored body:', postEn, postEn === 0 ? '✓' : '✗');
  console.log('  body length             :', stored.body.length, 'chars');

  console.log('\n' + '='.repeat(80));
  console.log('STORED ARTICLE ROW');
  console.log('='.repeat(80));
  console.log('  slug         :', stored.slug);
  console.log('  type         :', stored.type);
  console.log('  status       :', stored.status);
  console.log('  author       :', stored.author);
  console.log('  league_id    :', stored.league_id);
  console.log('  published_at :', stored.published_at.toISOString());
  console.log('  title        :', stored.title);
  console.log('  subtitle (dek):');
  console.log('    ' + stored.subtitle);
  console.log('  body:');
  console.log('────────────────────────────────────────────────────────────────────────');
  console.log(stored.body);
  console.log('────────────────────────────────────────────────────────────────────────');

  console.log('\nDONE.');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('\nFAILED:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
