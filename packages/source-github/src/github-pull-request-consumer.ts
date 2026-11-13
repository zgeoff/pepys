import { defineConsumer, defineTable } from '@pepys/kit';
import { pullRequestFamily } from './families/pull-request-family.ts';

export const githubPullRequestConsumer = defineConsumer({
  name: 'github_pull_request',
  entry: new URL('consumers/github-pull-request.ts', import.meta.url),
  input: { mode: 'fact', streams: [pullRequestFamily.stream] },
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

    // Each form a person writes for a pull request: its URL and `<owner>/<repo>#<number>`, in
    // lowercase, with the update time of the newest fact that names it. A rename adds the new forms
    // and keeps the old ones. A form moves only to a fact newer than that time.
    github_pull_request_alias: defineTable({
      columns: {
        alias: { kind: 'text' },
        entity_id: { kind: 'entityID' },
        updated_at: { kind: 'timestamp' },
      },
      primaryKey: ['alias'],
      indexes: [{ columns: ['entity_id'] }],
    }),

    // One row per release that a bot's pull request names in its body, by the release URL. The rows
    // follow the pull request row: a fact that loses writes none, and one that wins replaces them.
    github_release_bump: defineTable({
      columns: {
        pull_request_id: { kind: 'entityID' },
        release_repository: { kind: 'text' },
        release_tag: { kind: 'text' },
      },
      primaryKey: ['pull_request_id', 'release_repository', 'release_tag'],
      indexes: [{ columns: ['release_repository', 'release_tag'] }],
    }),
  },
  entityViews: [
    {
      table: 'github_pull_request',
      kind: pullRequestFamily.entityKind,
      id: 'id',
      title: 'title',
      url: 'url',
      actor: 'author_id',
      updatedAt: 'updated_at',
    },
  ],
  reads: ['github_pull_request', 'github_pull_request_alias'],
  links: [],
});
