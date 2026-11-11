import { defineConsumer, defineTable } from '@pepys/kit';
import { refFamily } from './families/ref-family.ts';

// One row per commit of a push to the default branch, and one for the commit a pushed tag names.
export const githubRefConsumer = defineConsumer({
  name: 'github_ref',
  entry: new URL('consumers/github-ref.ts', import.meta.url),
  input: { mode: 'fact', streams: [refFamily.stream] },
  tables: {
    github_commit: defineTable({
      columns: {
        repository_id: { kind: 'entityID' },
        sha: { kind: 'text' },
        committed_at: { kind: 'timestamp' },
      },
      primaryKey: ['repository_id', 'sha'],
      indexes: [],
    }),
  },
  entityViews: [],
  reads: [],
  links: [],
});
