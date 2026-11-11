import type { StreamOffset } from '@pepys/schema';

export type ChangeMessage =
  | {
      kind: 'change';
      type: string;
      key: string;
      value: unknown;
      oldValue: unknown;
      operation: 'insert' | 'update' | 'delete';
    }
  | { kind: 'snapshot-start' }
  | { kind: 'snapshot-end' };

export interface FeedStream {
  consumer: string;
  generation: number;
}

export type FeedPosition = StreamOffset | -1 | 'now';

export type FeedRead =
  | { kind: 'messages'; messages: readonly ChangeMessage[]; next: StreamOffset; atTail: boolean }
  | { kind: 'closed'; currentGeneration: number }
  | { kind: 'gone'; snapshotAt: StreamOffset };

export interface ChangeFeed {
  read: (
    stream: FeedStream,
    from: FeedPosition,
    mode: 'catch-up' | 'long-poll',
  ) => Promise<FeedRead>;
}
