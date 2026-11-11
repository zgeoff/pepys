import type { Sender, SenderProof } from '@pepys/kit';

// The test stand-in for a verifier of signed identity tokens: the value of the `imp-identity`
// header proves the sender it is mapped to, and any other value proves nothing.
export function createFakeSenderProof(senders: Readonly<Record<string, Sender>>): SenderProof {
  return {
    prove: (_requirement, headers) => {
      const token = headers.get('imp-identity');
      const sender = token !== null && Object.hasOwn(senders, token) ? senders[token] : undefined;

      return Promise.resolve(sender ?? null);
    },
  };
}
