import { readFactBatch } from './read-fact-batch.ts';
import type { ReceivePath } from './types.ts';

type FactBatchReceiver = Pick<
  ReceivePath,
  'route' | 'check' | 'bodyByteLimit' | 'factLimit' | 'reach' | 'sender'
>;

export function receiveFactBatch(receiver: FactBatchReceiver): ReceivePath {
  return { ...receiver, kind: 'receive', read: readFactBatch };
}
