import { expect, test } from 'bun:test';
import { loadIdentityIssuers, verifyImpIdentity } from '@impz/client/identity';
import { createIdentityIssuer } from './create-identity-issuer.ts';

test('it signs a token that the verifier accepts with the trust document of its issuer', async () => {
  const harbour = await createIdentityIssuer('harbour-host');

  const token = await harbour.signToken({
    audience: 'pepys-ingest',
    subject: 'imp-0193',
    name: 'tidy-otter',
    issuedAtSeconds: 1_794_370_812,
    expiresAtSeconds: 1_794_370_862,
  });

  const verified = await verifyImpIdentity(token, {
    issuers: loadIdentityIssuers([harbour.document]),
    audience: 'pepys-ingest',
    nowSeconds: 1_794_370_820,
  });

  expect(verified).toStrictEqual({ issuer: 'harbour-host', id: 'imp-0193', name: 'tidy-otter' });
});
