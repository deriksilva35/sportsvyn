// crew/lib/lobbyProbe.test.mjs - lobby-probe, the real bin end to end against a local http server.
// The server plays the site: it checks the session cookie it was sent, then answers with the lobby HTML
// each case needs. No network beyond 127.0.0.1, no secret (the "token" is a throwaway string).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMarkers, ageMarker, cookieHeader } from './lobbyProbe.mjs';
import { ageCookieValue } from '../../lib/auth/ageCookie.js';
import { SCRIPTS } from './cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'lobby-probe');
const TOKEN = 'tok_0123456789abcdef0123456789abcdef_NOT_REAL';
const SUMMARY = /^SUMMARY lobby-probe status=(ok|regression) modules=(\d+|-) hidden=(\d+|-) reason=\S+$/;

const marker = ({ modules = 45, hidden = 0, names = '', signedIn = 1 } = {}) =>
  `<div hidden="" data-sv-lobby-health="" data-modules="${modules}" data-hidden="${hidden}" data-hidden-names="${names}" data-signed-in="${signedIn}"></div>`;
const page = (inner) => `<!DOCTYPE html><html><body><main class="lob lv">${inner}</main></body></html>`;
const ERROR_PAGE = page('<section class="mod" data-sv-lobby-error=""><p class="muted">The lobby is having a moment. Try again shortly.</p></section>');

let server; let base; let respond; let seen;
before(async () => {
  server = http.createServer((req, res) => {
    seen = { url: req.url, cookie: req.headers.cookie ?? '', ua: req.headers['user-agent'] ?? '' };
    const r = respond(req);
    res.writeHead(r.status ?? 200, { 'content-type': 'text/html', ...(r.headers ?? {}) });
    res.end(r.body ?? '');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => new Promise((ok) => server.close(ok)));

function run({ token = TOKEN, url = base, args = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crew-lp-'));
  if (token !== null) writeFileSync(path.join(dir, 'probe.token'), `${token}\n`);
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, CREW_SECRETS_DIR: dir, CREW_PROBE_URL: url } });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
    const kill = setTimeout(() => p.kill(), 15_000);
    p.on('close', (status) => { clearTimeout(kill); rmSync(dir, { recursive: true, force: true }); resolve({ status, stdout, stderr }); });
  });
}
const last = (r) => r.stdout.trimEnd().split('\n').at(-1);

test('ok: marker present, signed in, nothing hidden -> exit 0 and the ok SUMMARY', async () => {
  respond = () => ({ body: page(marker({ modules: 45 })) });
  const r = await run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(last(r), 'SUMMARY lobby-probe status=ok modules=45 hidden=0 reason=-');
  assert.match(last(r), SUMMARY);
  // The request: plain-http URL -> the non-Secure cookie name, plus the age marker, and a non-shell UA.
  assert.match(seen.cookie, new RegExp(`^authjs\\.session-token=${TOKEN}; sv_age=[0-9a-f]{32}$`));
  assert.ok(!seen.ua.includes('SportsvynApp'));
  assert.equal(seen.url, '/');
});

test('hidden module: exit 1, one line per module, reason=hidden:<names joined by ,>', async () => {
  respond = () => ({ body: page(marker({ modules: 45, hidden: 2, names: 'daily-home,tonight' })) });
  const r = await run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /module hidden by error: daily-home/);
  assert.match(r.stdout, /module hidden by error: tonight/);
  assert.equal(last(r), 'SUMMARY lobby-probe status=regression modules=45 hidden=2 reason=hidden:daily-home,tonight');
});

test('error page: exit 1 reason=error_page', async () => {
  respond = () => ({ body: ERROR_PAGE });
  const r = await run();
  assert.equal(r.status, 1);
  assert.equal(last(r), 'SUMMARY lobby-probe status=regression modules=- hidden=- reason=error_page');
});

test('200 with no marker: exit 1 reason=no_marker; a 5xx: exit 1 reason=http_<code>', async () => {
  respond = () => ({ body: page('<p>hello</p>') });
  let r = await run();
  assert.equal(r.status, 1);
  assert.equal(last(r), 'SUMMARY lobby-probe status=regression modules=- hidden=- reason=no_marker');
  respond = () => ({ status: 503, body: 'down' });
  r = await run();
  assert.equal(r.status, 1);
  assert.equal(last(r), 'SUMMARY lobby-probe status=regression modules=- hidden=- reason=http_503');
});

test('no token (missing, or empty): exit 2 auth:probe.token, and the site is never called', async () => {
  let called = 0;
  respond = () => { called += 1; return { body: page(marker()) }; };
  for (const token of [null, '', '   \n']) {
    const r = await run({ token });
    assert.equal(r.status, 2, `token=${JSON.stringify(token)}`);
    assert.equal(last(r), 'SUMMARY lobby-probe status=error reason=auth:probe.token');
  }
  assert.equal(called, 0);
});

test('signed-in=0, and a redirect to sign-in or the age screen: exit 2 auth:probe.token', async () => {
  respond = () => ({ body: page(marker({ signedIn: 0 })) });
  let r = await run();
  assert.equal(r.status, 2);
  assert.equal(last(r), 'SUMMARY lobby-probe status=error reason=auth:probe.token');
  for (const location of ['/signin?callbackUrl=%2F', '/age/check?next=%2F']) {
    respond = () => ({ status: 307, headers: { location }, body: '' });
    r = await run();
    assert.equal(r.status, 2, location);
    assert.equal(last(r), 'SUMMARY lobby-probe status=error reason=auth:probe.token');
  }
});

test('unreachable and timeout: exit 2 with the host, an argument: exit 2 not_found:args', async () => {
  let r = await run({ url: 'http://127.0.0.1:1/' });
  assert.equal(r.status, 2);
  assert.match(last(r), /^SUMMARY lobby-probe status=error reason=unreachable:127\.0\.0\.1_?1?/);
  respond = () => ({ status: 404, body: 'x' });
  r = await run();
  assert.equal(last(r), `SUMMARY lobby-probe status=error reason=not_found:${new URL(base).host.replace(/[^A-Za-z0-9._-]/g, '_')}`);
  r = await run({ args: ['5'] });
  assert.equal(r.status, 2);
  assert.equal(last(r), 'SUMMARY lobby-probe status=error reason=not_found:args');
});

test('a hung server hits the 9.5 s deadline or the 6 s call timeout: exit 2 timeout, never a hang', async () => {
  const hang = http.createServer(() => { /* never answers */ });
  await new Promise((ok) => hang.listen(0, '127.0.0.1', ok));
  try {
    const r = await run({ url: `http://127.0.0.1:${hang.address().port}/` });
    assert.equal(r.status, 2);
    assert.match(last(r), /^SUMMARY lobby-probe status=error reason=timeout:/);
  } finally { hang.closeAllConnections?.(); await new Promise((ok) => hang.close(ok)); }
});

test('never prints the token or the cookie - on any path', async () => {
  const cases = [
    () => ({ body: page(marker()) }),
    () => ({ body: page(marker({ hidden: 1, names: 'tonight' })) }),
    () => ({ body: ERROR_PAGE }),
    () => ({ status: 500, body: `boom ${TOKEN}` }),
    () => ({ status: 307, headers: { location: `/signin?x=${TOKEN}` } }),
    () => ({ status: 403, body: TOKEN }),
  ];
  for (const c of cases) {
    respond = c;
    const r = await run();
    const all = r.stdout + r.stderr;
    assert.ok(!all.includes(TOKEN), 'token absent');
    assert.ok(!all.includes(ageMarker(TOKEN)), 'age marker absent');
    assert.ok(!/session-token=/.test(all), 'cookie absent');
  }
});

test('readMarkers: attribute order and extra attributes do not matter; a look-alike in text or script is not a marker', () => {
  const m = readMarkers('<div data-signed-in="1" data-hidden-names="a,b" class="x" data-hidden="2" data-modules="9" hidden data-sv-lobby-health></div>');
  assert.deepEqual(m.marker, { modules: 9, hidden: 2, names: ['a', 'b'], signedIn: true });
  const t = readMarkers('<p>data-sv-lobby-error and data-sv-lobby-health</p><script>{"data-sv-lobby-error":""}</script>');
  assert.equal(t.error, false);
  assert.equal(t.marker, null);
  assert.equal(readMarkers('<div data-sv-lobby-health data-modules="x" data-hidden="0"></div>').marker, null, 'garbled counts are no marker');
});

test('the cookie is the one the app reads: name by scheme, age marker = lib/auth/ageCookie.js', () => {
  assert.equal(ageMarker(TOKEN), ageCookieValue(TOKEN));
  assert.match(cookieHeader('https://sportsvyn.com/', TOKEN), /^__Secure-authjs\.session-token=/);
  assert.match(cookieHeader('http://localhost:3000/', TOKEN), /^authjs\.session-token=/);
});

test('lobby-probe is in the cli table', () => {
  assert.ok(SCRIPTS['lobby-probe']);
});
