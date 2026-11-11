import { expect, test } from 'bun:test';
import { createFakeSenderProof } from './create-fake-sender-proof.ts';

function setupTest() {
  const requirement = {
    kind: 'imp-identity',
    audienceEnv: 'BEACON_AUDIENCE',
    issuersEnv: 'BEACON_ISSUERS',
  } as const;

  return {
    prove: (senders: Parameters<typeof createFakeSenderProof>[0], headers: Headers) =>
      createFakeSenderProof(senders).prove(requirement, headers),
  };
}

test('it proves the sender that the identity header maps to', async () => {
  const ctx = setupTest();
  const sender = { issuer: 'https://id.example', subject: 'worker-4', name: 'worker four' };

  const proven = await ctx.prove({ 'token-4': sender }, new Headers({ 'imp-identity': 'token-4' }));

  expect(proven).toStrictEqual(sender);
});

test.each([
  { row: 'no identity header', headers: new Headers() },
  {
    row: 'an identity header it does not know',
    headers: new Headers({ 'imp-identity': 'token-5' }),
  },
  { row: 'an inherited key as the header', headers: new Headers({ 'imp-identity': 'toString' }) },
])('it proves no sender for $row', async (row) => {
  const ctx = setupTest();

  const proven = await ctx.prove(
    { 'token-4': { issuer: 'https://id.example', subject: 'worker-4', name: 'worker four' } },
    row.headers,
  );

  expect(proven).toBeNull();
});
