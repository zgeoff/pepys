import { defineConsumer, defineTable } from '@pepys/schema';

export const githubPullRequestConsumer = defineConsumer({
  name: 'github_pull_request',
  mode: 'fact',
  streams: ['facts.github.pull_request'],
  tables: {
    github_pull_request: defineTable({
      columns: {
        id: { kind: 'entityID' },
        number: { kind: 'integer' },
        repository_id: { kind: 'entityID' },
        title: { kind: 'text' },
        state: { kind: 'text' },
        is_draft: { kind: 'boolean' },
        is_merged: { kind: 'boolean' },
        author_id: { kind: 'entityID', nullable: true },
        url: { kind: 'text' },
        merge_commit_sha: { kind: 'text', nullable: true },
        created_at: { kind: 'timestamp' },
        updated_at: { kind: 'timestamp' },
        closed_at: { kind: 'timestamp', nullable: true },
        merged_at: { kind: 'timestamp', nullable: true },
        payload: { kind: 'json' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['repository_id'] }],
    }),
  },
  entityView: {
    table: 'github_pull_request',
    kind: 'pr',
    id: 'id',
    title: 'title',
    url: 'url',
    actor: 'author_id',
    updatedAt: 'updated_at',
  },
  reads: ['github_pull_request'],
});
