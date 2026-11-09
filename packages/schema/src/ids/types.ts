import type { Tagged } from 'type-fest';

export type EntityID = Tagged<string, 'EntityID'>;

export type FactID = Tagged<string, 'FactID'>;

export type StreamName = Tagged<string, 'StreamName'>;

export type StreamOffset = Tagged<number, 'StreamOffset'>;

export type ScopeID = Tagged<string, 'ScopeID'>;

export type BlobHash = Tagged<string, 'BlobHash'>;

export type VersionHash = Tagged<string, 'VersionHash'>;

export type Reference = Tagged<string, 'Reference'>;

export type BucketNumber = Tagged<number, 'BucketNumber'>;

export type ClientID = Tagged<string, 'ClientID'>;

export type GrantID = Tagged<string, 'GrantID'>;

export type RequestID = Tagged<string, 'RequestID'>;
