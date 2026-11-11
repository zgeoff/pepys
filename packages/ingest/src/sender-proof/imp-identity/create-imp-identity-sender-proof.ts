import type { Sender, SenderProof } from '@pepys/kit';
import type { ImpIdentityTrust, ImpIdentityVerifier, VerifiedImp } from './types.ts';

interface ImpIdentityOptions<Document> {
  verify: ImpIdentityVerifier<Document>['verify'];
  trust: ImpIdentityTrust<Document>;
  now: () => number;
}

// The broker removes any `Imp-Identity` header a guest sends and adds its own: a compact JWS. A
// header of any other shape, two joined headers included, never reaches the verifier.
const compactToken = /^[\w-]+\.[\w-]+\.[\w-]+$/u;

// Proves the sender from the signed identity token of a worker's machine. The issuer and the
// subject come only from the verified token, and every failure, a throw included, proves nothing.
// It never logs the token.
export function createImpIdentitySenderProof<Document>(
  options: ImpIdentityOptions<Document>,
): SenderProof {
  return {
    prove: async (requirement, headers) => {
      const documents = options.trust.issuers.get(requirement.issuersEnv) ?? [];
      const audience = options.trust.audiences.get(requirement.audienceEnv);
      const header = headers.get('imp-identity');

      if (
        documents.length === 0 ||
        audience === undefined ||
        header === null ||
        !compactToken.test(header)
      ) {
        return null;
      }

      try {
        const verified = await options.verify(header, {
          issuers: documents,
          audience,
          nowSeconds: Math.floor(options.now() / 1000),
        });

        return verified === null ? null : toSender(verified);
      } catch {
        console.error('the identity verifier failed, so the delivery proves no sender');

        return null;
      }
    },
  };
}

function toSender(verified: VerifiedImp): Sender | null {
  if (verified.issuer === '' || verified.id === '') {
    return null;
  }

  return { issuer: verified.issuer, subject: verified.id, name: verified.name };
}
