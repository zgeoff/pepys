import type { Tagged } from 'type-fest';

export type { EntityID, FactID } from '@pepys/schema';

// A stream name such as `facts.github.pull_request`.
export type StreamName = Tagged<string, 'StreamName'>;

// A position in one stream: the sequence number of the next fact to read.
export type StreamOffset = Tagged<number, 'StreamOffset'>;

// The entity ID of the scope a scope-mode consumer or an enrichment job works on, such as a pull
// request or a Gmail thread.
export type ScopeID = Tagged<string, 'ScopeID'>;

// The hash of a blob's content, which is also its name in the blobs bucket.
export type BlobHash = Tagged<string, 'BlobHash'>;

// The hash that names one version of a consumer module, an enrichment job or a strategy: its code,
// plus its model, prompt and data files where it has them.
export type VersionHash = Tagged<string, 'VersionHash'>;

// A reference as text wrote it, such as `acme/api#412`, before the alias table resolves it.
export type Reference = Tagged<string, 'Reference'>;

// One of the 100 buckets that a hash of a scope ID falls into, from 0 to 99.
export type BucketNumber = Tagged<number, 'BucketNumber'>;

// The client that wrote a manual fact: the owner, or one named agent.
export type ClientID = Tagged<string, 'ClientID'>;
