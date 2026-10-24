import {
  AppendInput,
  AppendRecord,
  FencingTokenMismatchError,
  SeqNumMismatchError,
} from '@s2-dev/streamstore';
import type { S2Stream } from '@s2-dev/streamstore';

export type AppendOutcome =
  | { readonly kind: 'acknowledged'; readonly seqNum: number }
  | { readonly kind: 'seqNumMismatch'; readonly expectedSeqNum: number }
  | { readonly kind: 'fencingTokenMismatch'; readonly expectedFencingToken: string };

interface AppendConditions {
  readonly matchSeqNum?: number;
  readonly fencingToken?: string;
}

export async function runAppendOutcome(
  stream: S2Stream,
  conditions: AppendConditions,
  record = AppendRecord.string({ body: 'conditional' }),
): Promise<AppendOutcome> {
  try {
    const ack = await stream.append(AppendInput.create([record], conditions));

    return { kind: 'acknowledged', seqNum: ack.start.seqNum };
  } catch (error: unknown) {
    if (error instanceof SeqNumMismatchError) {
      return { kind: 'seqNumMismatch', expectedSeqNum: error.expectedSeqNum };
    }

    if (error instanceof FencingTokenMismatchError) {
      return { kind: 'fencingTokenMismatch', expectedFencingToken: error.expectedFencingToken };
    }

    throw error;
  }
}
