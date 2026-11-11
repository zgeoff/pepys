import type { IdentityTrustDocument } from '@impz/client/identity';

// What the deployment trusts, read from its environment at start: the trust documents of each
// `issuersEnv` and the audience of each `audienceEnv` that its paths name. A name with no entry
// refuses every delivery on its paths.
export interface ImpIdentityTrust {
  readonly issuers: ReadonlyMap<string, readonly IdentityTrustDocument[]>;
  readonly audiences: ReadonlyMap<string, string>;
}
