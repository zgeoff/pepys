import type { SenderProof } from '@pepys/kit';

// Proves no sender, so a path that needs one refuses every delivery. Ingest uses it for a path whose
// trust documents are missing.
export const noSenderProof: SenderProof = {
  prove: () => Promise.resolve(null),
};
