import type { verifyImpIdentity } from '@impz/client/identity';
import { createLogger } from '@pepys/kit';
import type { Logger, SenderProof } from '@pepys/kit';
import type { ImpIdentityTrust } from './types.ts';

interface ImpIdentityOptions {
  verify: typeof verifyImpIdentity;
  trust: ImpIdentityTrust;
  now: () => number;

  // defaults to a logger that writes to stderr
  logger?: Logger | undefined;
}

// Proves the sender from the signed identity token in the `imp-identity` header. The issuer and
// the subject come only from the verified token, and every failure, a throw included, proves
// nothing. It never logs the token.
export function createImpIdentitySenderProof(options: ImpIdentityOptions): SenderProof {
  const logger = options.logger ?? createLogger(process.stderr);

  return {
    prove: async (requirement, headers) => {
      const documents = options.trust.issuers.get(requirement.issuersEnv) ?? [];
      const audience = options.trust.audiences.get(requirement.audienceEnv);

      // The verifier throws on an empty list of documents, so a path with none refuses here.
      if (documents.length === 0 || audience === undefined) {
        return null;
      }

      try {
        const verified = await options.verify(headers.get('imp-identity'), {
          issuers: documents,
          audience,
          nowSeconds: Math.floor(options.now() / 1000),
        });

        return verified === null
          ? null
          : { issuer: verified.issuer, subject: verified.id, name: verified.name };
      } catch {
        logger.error('the identity verifier failed, so the delivery proves no sender');

        return null;
      }
    },
  };
}
