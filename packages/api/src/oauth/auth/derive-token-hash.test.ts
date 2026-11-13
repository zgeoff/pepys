import { expect, test } from 'bun:test';
import { deriveTokenHash } from './derive-token-hash.ts';

test('it hashes a token to its base64url SHA-256', () => {
  expect(deriveTokenHash('pepys_at_example')).toBe('SbyMLgW4okQMHZdgdA7l3eqUfwoCgw_ce8wqxWBs1Hg');
});
