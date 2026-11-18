import { expect, test } from 'bun:test';
import { buildKeyID } from './build-key-id.ts';

test('#buildKeyID returns the RFC 7638 SHA-256 thumbprint of an EC key', () => {
  const keyID = buildKeyID({
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
    y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
  });

  expect(keyID).toBe('oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U');
});
