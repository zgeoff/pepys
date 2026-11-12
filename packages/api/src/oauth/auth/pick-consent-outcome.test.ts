import { expect, test } from 'bun:test';
import { pickConsentOutcome } from './pick-consent-outcome.ts';
import type { SecurityOutcome } from './types.ts';

test.each<[string, boolean, boolean, SecurityOutcome]>([
  ['a code was issued', true, false, { kind: 'consent', outcome: 'allowed' }],
  [
    'no code was issued for an allow with nothing ticked',
    false,
    true,
    { kind: 'consent', outcome: 'denied', reason: 'none_ticked' },
  ],
  ['no code was issued for a deny', false, false, { kind: 'consent', outcome: 'denied' }],
])('it picks the consent outcome when %s', (_title, issuedCode, noneTicked, outcome) => {
  expect(pickConsentOutcome(issuedCode, noneTicked)).toStrictEqual(outcome);
});
