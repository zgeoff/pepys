import { GRANT_SCOPES } from '../constants.ts';

// `scope` is what the grant holds, null when the choice denies. `noneTicked` is an allow sent with
// no scope ticked, which denies.
interface ConsentChoice {
  readonly accept: boolean;
  readonly scope: string | null;
  readonly noneTicked: boolean;
}

// The owner's answer on the consent form, from the scopes it ticked and its decision. A ticked
// value that is no grant scope counts for nothing.
export function pickConsentChoice(
  ticked: readonly string[],
  decision: string | null,
): ConsentChoice {
  const scopes = GRANT_SCOPES.filter((scope) => ticked.includes(scope));
  const allow = decision === 'approve';
  const accept = allow && scopes.length > 0;

  return {
    accept,
    scope: accept ? [...scopes, 'offline_access'].join(' ') : null,
    noneTicked: allow && !accept,
  };
}
