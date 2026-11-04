import type { BucketNumber } from './ids.ts';

// Every `pepys` command. The host binary owns the consumer commands; the enrichment and ingest
// commands run in the TypeScript services and share the `pepys` name through one entry point.
export type PepysCommand =
  | { kind: 'run'; consumer: string }
  | { kind: 'preview'; consumer: string; module: string }
  | { kind: 'up'; consumer: string; module: string }
  | { kind: 'preview-enrich'; job: string }
  | { kind: 'up-enrich'; job: string }
  | { kind: 'sample-enrich'; job: string; buckets: readonly BucketNumber[] }
  | { kind: 'backfill'; source: string }
  | { kind: 'recover'; source: string }
  | { kind: 'resync'; source: string };
