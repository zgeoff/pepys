import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Webhooks } from '@octokit/webhooks';
import { buildDeliveryProof } from './build-delivery-proof.ts';
import { isDeliveryAuthentic } from './is-delivery-authentic.ts';

function setupTest() {
  const encoder = new TextEncoder();

  const signed = {
    kind: 'hmac-sha256',
    header: 'x-ledger-signature-256',
    secretEnv: 'LEDGER_SIGNING_SECRET',
  } as const;

  const tokened = { kind: 'token', header: 'authorization', secretEnv: 'LEDGER_TOKEN' } as const;

  return {
    isSignedAuthentic: (secret: string, headers: Headers, body: string): boolean =>
      isDeliveryAuthentic(signed, secret, headers, encoder.encode(body)),
    buildSignedProof: (secret: string, body: string): string =>
      buildDeliveryProof(signed, secret, encoder.encode(body)),
    isTokenAuthentic: (secret: string, headers: Headers): boolean =>
      isDeliveryAuthentic(tokened, secret, headers, encoder.encode('{}')),
  };
}

test('it passes a body that another HMAC signer signed with the same secret', async () => {
  const ctx = setupTest();
  const body = '{"v":1,"facts":[]}';

  const signature = await new Webhooks({ secret: 'tide-table' }).sign(body);

  const isAuthentic = ctx.isSignedAuthentic(
    'tide-table',
    new Headers({ 'x-ledger-signature-256': signature }),
    body,
  );

  expect(isAuthentic).toBeTrue();
});

test('it passes a signature in capital hex', () => {
  const ctx = setupTest();
  const body = '{"v":1,"facts":[]}';
  const proof = ctx.buildSignedProof('tide-table', body);

  const isAuthentic = ctx.isSignedAuthentic(
    'tide-table',
    new Headers({ 'x-ledger-signature-256': `sha256=${proof.slice(7).toUpperCase()}` }),
    body,
  );

  expect(isAuthentic).toBeTrue();
});

test.each([
  { row: 'a signature made with another secret', secret: 'neap-tide', body: '{"v":1,"facts":[]}' },
  { row: 'a body changed after it was signed', secret: 'tide-table', body: '{"v":1,"facts":[{}]}' },
])('it refuses $row', async (row) => {
  const ctx = setupTest();

  const signature = await new Webhooks({ secret: row.secret }).sign('{"v":1,"facts":[]}');

  const isAuthentic = ctx.isSignedAuthentic(
    'tide-table',
    new Headers({ 'x-ledger-signature-256': signature }),
    row.body,
  );

  expect(isAuthentic).toBeFalse();
});

test.each([
  { row: 'no prefix', header: 'a'.repeat(64) },
  { row: 'another scheme', header: `sha1=${'a'.repeat(64)}` },
  { row: 'hex that is too short', header: `sha256=${'a'.repeat(62)}` },
  { row: 'hex that is too long', header: `sha256=${'a'.repeat(66)}` },
  { row: 'a character that is not hex', header: `sha256=${'g'.repeat(64)}` },
  { row: 'an empty value', header: '' },
])('it refuses a signature header with $row', (row) => {
  const ctx = setupTest();

  const isAuthentic = ctx.isSignedAuthentic(
    'tide-table',
    new Headers({ 'x-ledger-signature-256': row.header }),
    '{"v":1,"facts":[]}',
  );

  expect(isAuthentic).toBeFalse();
});

test('it refuses a delivery with no signature header', () => {
  const ctx = setupTest();
  const isAuthentic = ctx.isSignedAuthentic('tide-table', new Headers(), '{"v":1,"facts":[]}');

  expect(isAuthentic).toBeFalse();
});

test('it refuses every delivery when the secret is empty, even one signed with it', () => {
  const ctx = setupTest();
  const body = '{"v":1,"facts":[]}';
  const signature = `sha256=${createHmac('sha256', '').update(body).digest('hex')}`;

  const isAuthentic = ctx.isSignedAuthentic(
    '',
    new Headers({ 'x-ledger-signature-256': signature }),
    body,
  );

  expect(isAuthentic).toBeFalse();
});

test.each([
  { row: 'the bare secret', header: 'harbour-key' },
  { row: 'the secret after Bearer', header: 'Bearer harbour-key' },
])('it passes a token header that holds $row', (row) => {
  const ctx = setupTest();

  const isAuthentic = ctx.isTokenAuthentic(
    'harbour-key',
    new Headers({ authorization: row.header }),
  );

  expect(isAuthentic).toBeTrue();
});

test.each([
  { row: 'another token', header: 'Bearer harbour-lock' },
  { row: 'the secret with more after it', header: 'harbour-key2' },
  { row: 'a lower case bearer', header: 'bearer harbour-key' },
])('it refuses a token header that holds $row', (row) => {
  const ctx = setupTest();

  const isAuthentic = ctx.isTokenAuthentic(
    'harbour-key',
    new Headers({ authorization: row.header }),
  );

  expect(isAuthentic).toBeFalse();
});

test('it refuses a token when the secret is empty', () => {
  const ctx = setupTest();
  const isAuthentic = ctx.isTokenAuthentic('', new Headers({ authorization: 'Bearer ' }));

  expect(isAuthentic).toBeFalse();
});
