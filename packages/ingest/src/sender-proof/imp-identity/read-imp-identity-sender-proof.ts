import { verifyImpIdentity } from '@impz/client/identity';
import type { Result, SenderProof, SourceDefinition } from '@pepys/kit';
import { createImpIdentitySenderProof } from './create-imp-identity-sender-proof.ts';
import { readImpIdentityTrust } from './read-imp-identity-trust.ts';

interface SenderProofReadOptions {
  sources: readonly SourceDefinition[];
  environment: Readonly<Record<string, string | undefined>>;
  now: () => number;
}

// The sender proof that `serveIngest` runs: the trust of the deployment's environment and the
// verifier of `@impz/client/identity`. It fails only when a set folder cannot be read or holds an
// invalid document.
export async function readImpIdentitySenderProof(
  options: SenderProofReadOptions,
): Promise<Result<SenderProof, string>> {
  const trust = await readImpIdentityTrust({
    sources: options.sources,
    environment: options.environment,
  });

  if (!trust.ok) {
    return trust;
  }

  return {
    ok: true,
    value: createImpIdentitySenderProof({
      verify: verifyImpIdentity,
      trust: trust.value,
      now: options.now,
    }),
  };
}
