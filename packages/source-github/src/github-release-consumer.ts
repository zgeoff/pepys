import { defineConsumer, defineTable } from '@pepys/kit';
import { releaseFamily } from './families/release-family.ts';

// One row per release, never deleted: a release GitHub deleted keeps its row with `deleted_at`.
export const githubReleaseConsumer = defineConsumer({
  name: 'github_release',
  entry: new URL('consumers/github-release.ts', import.meta.url),
  input: { mode: 'fact', streams: [releaseFamily.stream] },
  tables: {
    github_release: defineTable({
      columns: {
        id: { kind: 'entityID' },
        repository_id: { kind: 'entityID' },
        repository_full_name: { kind: 'text' },
        tag_name: { kind: 'text' },
        target_commitish: { kind: 'text' },
        name: { kind: 'text' },
        url: { kind: 'text' },
        is_draft: { kind: 'boolean' },
        is_prerelease: { kind: 'boolean' },
        created_at: { kind: 'timestamp' },
        published_at: { kind: 'timestamp', nullable: true },
        updated_at: { kind: 'timestamp' },
        deleted_at: { kind: 'timestamp', nullable: true },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['repository_id'] }, { columns: ['repository_full_name', 'tag_name'] }],
    }),
  },
  entityViews: [
    {
      table: 'github_release',
      kind: releaseFamily.entityKind,
      id: 'id',
      title: 'name',
      url: 'url',
      actor: null,
      updatedAt: 'updated_at',
    },
  ],
  reads: ['github_release'],
  links: [],
});
