import type { StreamOffset, VersionHash } from './ids.ts';
import type { Provisional } from './provisional.ts';

// One State Protocol message in a consumer's change log. The host sends an insert for a new key and
// an update for an existing one, so a client never meets the protocol's undefined cases.
export type ChangeMessage = Provisional<
  'durable-streams-conformance',
  | {
      kind: 'change';
      type: string;
      key: string;
      value: unknown;
      oldValue: unknown;
      operation: 'insert' | 'update' | 'delete';
    }
  | { kind: 'snapshot-start' }
  | { kind: 'snapshot-end' }
>;

// One consumer's stream. Its generation is the consumer's module version.
export interface FeedStream {
  consumer: string;
  generation: VersionHash;
}

// `-1` reads from the start, and `now` reads from the tail.
export type FeedPosition = StreamOffset | -1 | 'now';

// The read side of Durable Streams that the API serves: a catch-up read, long-poll and server-sent
// events.
export type FeedRead = Provisional<
  'durable-streams-conformance',
  | { kind: 'messages'; messages: readonly ChangeMessage[]; next: StreamOffset; atTail: boolean }
  | { kind: 'closed'; currentGeneration: VersionHash }
  | { kind: 'gone'; snapshotAt: StreamOffset }
>;

export interface ChangeFeed {
  read: (
    stream: FeedStream,
    from: FeedPosition,
    mode: 'catch-up' | 'long-poll',
  ) => Promise<FeedRead>;
}
