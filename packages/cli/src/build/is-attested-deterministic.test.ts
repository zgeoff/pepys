import { expect, test } from 'bun:test';
import { isAttestedDeterministic } from './is-attested-deterministic.ts';

test.each([
  ['a contract that attests determinism', { deterministic: true }, true],
  ['a contract that denies determinism', { deterministic: false }, false],
  ['a contract with the flag as text', { deterministic: 'true' }, false],
  ['a contract with no flag', { exports: [] }, false],
  ['a null contract', null, false],
  ['a contract that is no object', 'deterministic', false],
])('it answers for %s', (_title, contract, expected) => {
  expect(isAttestedDeterministic(contract)).toBe(expected);
});
