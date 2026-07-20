// lib/auth/appleClientSecret.test.mjs — the Apple client-secret JWT builder.
// Uses a throwaway P-256 key pair so the test signs and verifies a real
// ES256 token without touching the production Apple key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, jwtVerify, decodeProtectedHeader } from 'jose';
import {
  signAppleClientSecret,
  toPkcs8Pem,
  appleConfigured,
} from './appleClientSecret.js';

const KID = 'ABC123KEYID';
const TEAM = 'TEAM123456';
const CLIENT = 'com.sportsvyn.web';

async function makeKeyPair() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', {
    extractable: true,
  });
  return { pem: await exportPKCS8(privateKey), publicKey };
}

test('signs an ES256 JWT with kid in the header', async () => {
  const { pem } = await makeKeyPair();
  const jwt = await signAppleClientSecret({
    teamId: TEAM,
    keyId: KID,
    clientId: CLIENT,
    privateKeyPem: pem,
  });
  const header = decodeProtectedHeader(jwt);
  assert.equal(header.alg, 'ES256');
  assert.equal(header.kid, KID);
});

test('carries Apple-required claims: iss=team, sub=clientId, aud=appleid', async () => {
  const { pem, publicKey } = await makeKeyPair();
  const jwt = await signAppleClientSecret({
    teamId: TEAM,
    keyId: KID,
    clientId: CLIENT,
    privateKeyPem: pem,
  });
  const { payload } = await jwtVerify(jwt, publicKey, {
    audience: 'https://appleid.apple.com',
  });
  assert.equal(payload.iss, TEAM);
  assert.equal(payload.sub, CLIENT);
  assert.equal(payload.aud, 'https://appleid.apple.com');
  assert.ok(payload.iat, 'iat is set');
  assert.ok(payload.exp > payload.iat, 'exp is after iat');
  // Must not exceed Apple's 6-month (15777000s) ceiling.
  assert.ok(payload.exp - payload.iat <= 15777000, 'ttl within Apple cap');
});

test('accepts a single-line key with literal \\n escapes', async () => {
  const { pem, publicKey } = await makeKeyPair();
  const singleLine = pem.replace(/\n/g, '\\n');
  assert.ok(singleLine.includes('\\n'), 'test setup produced escaped newlines');
  const jwt = await signAppleClientSecret({
    teamId: TEAM,
    keyId: KID,
    clientId: CLIENT,
    privateKeyPem: singleLine,
  });
  // Verifies only if the PEM newlines were restored before importPKCS8.
  const { payload } = await jwtVerify(jwt, publicKey);
  assert.equal(payload.sub, CLIENT);
});

test('toPkcs8Pem leaves a real-newline PEM untouched', () => {
  const real = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
  assert.equal(toPkcs8Pem(real), real);
});

test('toPkcs8Pem re-armors bare base64 DER, and it verifies end-to-end', async () => {
  const { pem, publicKey } = await makeKeyPair();
  // Strip the PEM armor to a single bare base64 line — the exact shape a
  // stripped .p8 paste produces.
  const bare = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const rearmored = toPkcs8Pem(bare);
  assert.ok(rearmored.startsWith('-----BEGIN PRIVATE KEY-----'));
  assert.ok(rearmored.includes('-----END PRIVATE KEY-----'));
  // The re-armored key must actually sign a verifiable token.
  const jwt = await signAppleClientSecret({
    teamId: TEAM,
    keyId: KID,
    clientId: CLIENT,
    privateKeyPem: bare,
  });
  const { payload } = await jwtVerify(jwt, publicKey);
  assert.equal(payload.sub, CLIENT);
});

test('appleConfigured reflects presence of all four env vars', () => {
  const keys = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    keys.forEach((k) => delete process.env[k]);
    assert.equal(appleConfigured(), false);
    keys.forEach((k) => (process.env[k] = 'x'));
    assert.equal(appleConfigured(), true);
    delete process.env.APPLE_PRIVATE_KEY;
    assert.equal(appleConfigured(), false, 'one missing var is enough to fail');
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
