import type { SecurityOutcome } from './types.ts';

// `noneTicked` is an allow sent with no scope ticked, which denies.
export function pickConsentOutcome(issuedCode: boolean, noneTicked: boolean): SecurityOutcome {
  if (issuedCode) {
    return { kind: 'consent', outcome: 'allowed' };
  }

  return noneTicked
    ? { kind: 'consent', outcome: 'denied', reason: 'none_ticked' }
    : { kind: 'consent', outcome: 'denied' };
}
