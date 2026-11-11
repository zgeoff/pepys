import { expect, test } from 'bun:test';
import { noSenderProof } from './no-sender-proof.ts';

test('it proves no sender, even for a delivery that carries an identity header', async () => {
  const proven = await noSenderProof.prove(
    { kind: 'imp-identity', audienceEnv: 'BEACON_AUDIENCE', issuersEnv: 'BEACON_ISSUERS' },
    new Headers({ 'imp-identity': 'token-4', authorization: 'Bearer harbour-key' }),
  );

  expect(proven).toBeNull();
});
