import { expect, test } from 'bun:test';
import { createStubHostRead } from '@pepys/kit/test-utils/create-stub-host-read';
import { applyFact } from './github-release.ts';

function setupTest() {
  const rows = new Map<string, string>();

  createStubHostRead('GithubRelease', rows);

  return {
    rows,
    apply: (fact: unknown): unknown => JSON.parse(applyFact(JSON.stringify(fact))),
  };
}

test('it upserts the row of a new release', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.release.published',
    at: '2026-10-01T09:06:00Z',
    payload: {
      action: 'published',
      release: {
        id: 5,
        tag_name: 'v1.2.0',
        target_commitish: 'c0ffee1',
        name: 'Harbour 1.2.0',
        html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
        draft: false,
        prerelease: false,
        created_at: '2026-10-01T09:00:00Z',
        published_at: '2026-10-01T09:05:00Z',
      },
      repository: { id: 902, full_name: 'acme/harbour' },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_release: {
          id: 'github:release:5',
          repository_id: 'github:repo:902',
          repository_full_name: 'acme/harbour',
          tag_name: 'v1.2.0',
          target_commitish: 'c0ffee1',
          name: 'Harbour 1.2.0',
          url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
          is_draft: false,
          is_prerelease: false,
          created_at: '2026-10-01T09:00:00Z',
          published_at: '2026-10-01T09:05:00Z',
          updated_at: '2026-10-01T09:06:00Z',
          deleted_at: null,
        },
      },
    },
  ]);
});

test('it names a release with no name after its tag', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.release.created',
    at: '2026-10-01T09:00:00Z',
    payload: {
      release: {
        id: 5,
        tag_name: 'v1.2.0',
        target_commitish: 'main',
        name: null,
        html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
        draft: true,
        prerelease: false,
        created_at: '2026-10-01T09:00:00Z',
        published_at: null,
      },
      repository: { id: 902, full_name: 'acme/harbour' },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_release: {
          id: 'github:release:5',
          repository_id: 'github:repo:902',
          repository_full_name: 'acme/harbour',
          tag_name: 'v1.2.0',
          target_commitish: 'main',
          name: 'v1.2.0',
          url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
          is_draft: true,
          is_prerelease: false,
          created_at: '2026-10-01T09:00:00Z',
          published_at: null,
          updated_at: '2026-10-01T09:00:00Z',
          deleted_at: null,
        },
      },
    },
  ]);
});

test.each([
  { row: 'as old as the stored row', at: '2026-10-01T09:00:00Z' },
  { row: 'newer than the stored row', at: '2026-10-01T10:00:00Z' },
])('it takes the columns of a fact $row', (row) => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:release:5',
    JSON.stringify({
      id: 'github:release:5',
      repository_id: 'github:repo:902',
      repository_full_name: 'acme/harbour',
      tag_name: 'v1.2.0',
      target_commitish: 'c0ffee1',
      name: 'Harbour 1.2.0',
      url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
      is_draft: true,
      is_prerelease: false,
      created_at: '2026-10-01T09:00:00Z',
      published_at: null,
      updated_at: '2026-10-01T09:00:00Z',
      deleted_at: null,
    }),
  );

  const operations = ctx.apply({
    type: 'github.release.published',
    at: row.at,
    payload: {
      release: {
        id: 5,
        tag_name: 'v1.2.0',
        target_commitish: 'c0ffee1',
        name: 'Harbour 1.2.0',
        html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
        draft: false,
        prerelease: false,
        created_at: '2026-10-01T09:00:00Z',
        published_at: row.at,
      },
      repository: { id: 902, full_name: 'acme/harbour' },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_release: {
          id: 'github:release:5',
          repository_id: 'github:repo:902',
          repository_full_name: 'acme/harbour',
          tag_name: 'v1.2.0',
          target_commitish: 'c0ffee1',
          name: 'Harbour 1.2.0',
          url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
          is_draft: false,
          is_prerelease: false,
          created_at: '2026-10-01T09:00:00Z',
          published_at: row.at,
          updated_at: row.at,
          deleted_at: null,
        },
      },
    },
  ]);
});

test('it returns no operations for a fact older than the stored row', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:release:5',
    JSON.stringify({
      id: 'github:release:5',
      repository_id: 'github:repo:902',
      repository_full_name: 'acme/harbour',
      tag_name: 'v1.2.0',
      target_commitish: 'c0ffee1',
      name: 'Harbour 1.2.0',
      url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
      is_draft: true,
      is_prerelease: false,
      created_at: '2026-10-01T09:00:00Z',
      published_at: null,
      updated_at: '2026-10-01T09:00:00Z',
      deleted_at: null,
    }),
  );

  const operations = ctx.apply({
    type: 'github.release.published',
    at: '2026-10-01T08:00:00Z',
    payload: {
      release: {
        id: 5,
        tag_name: 'v1.2.0',
        target_commitish: 'c0ffee1',
        name: 'Harbour 1.2.0',
        html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
        draft: false,
        prerelease: false,
        created_at: '2026-10-01T09:00:00Z',
        published_at: '2026-10-01T08:00:00Z',
      },
      repository: { id: 902, full_name: 'acme/harbour' },
    },
  });

  expect(operations).toStrictEqual([]);
});

test('it keeps a tombstone when a newer fact changes the other columns', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:release:5',
    JSON.stringify({
      id: 'github:release:5',
      repository_id: 'github:repo:902',
      repository_full_name: 'acme/harbour',
      tag_name: 'v1.2.0',
      target_commitish: 'c0ffee1',
      name: 'Harbour 1.2.0',
      url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
      is_draft: false,
      is_prerelease: false,
      created_at: '2026-10-01T09:00:00Z',
      published_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
      deleted_at: '2026-10-01T09:30:00Z',
    }),
  );

  const operations = ctx.apply({
    type: 'github.release.edited',
    at: '2026-10-01T10:00:00Z',
    payload: {
      release: {
        id: 5,
        tag_name: 'v1.2.0',
        target_commitish: 'c0ffee1',
        name: 'Harbour 1.2.0 renamed',
        html_url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
        draft: false,
        prerelease: false,
        created_at: '2026-10-01T09:00:00Z',
        published_at: '2026-10-01T09:00:00Z',
      },
      repository: { id: 902, full_name: 'acme/harbour' },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_release: {
          id: 'github:release:5',
          repository_id: 'github:repo:902',
          repository_full_name: 'acme/harbour',
          tag_name: 'v1.2.0',
          target_commitish: 'c0ffee1',
          name: 'Harbour 1.2.0 renamed',
          url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
          is_draft: false,
          is_prerelease: false,
          created_at: '2026-10-01T09:00:00Z',
          published_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T10:00:00Z',
          deleted_at: '2026-10-01T09:30:00Z',
        },
      },
    },
  ]);
});

test('it sets the tombstone of an older deleted fact and keeps the newer columns', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:release:5',
    JSON.stringify({
      id: 'github:release:5',
      repository_id: 'github:repo:902',
      repository_full_name: 'acme/harbour',
      tag_name: 'v1.2.0',
      target_commitish: 'c0ffee1',
      name: 'Harbour 1.2.0',
      url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
      is_draft: false,
      is_prerelease: false,
      created_at: '2026-10-01T09:00:00Z',
      published_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      deleted_at: null,
    }),
  );

  const operations = ctx.apply({
    type: 'github.release.deleted',
    at: '2026-10-01T09:30:00Z',
    payload: { action: 'deleted', release: { id: 5 } },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_release: {
          id: 'github:release:5',
          repository_id: 'github:repo:902',
          repository_full_name: 'acme/harbour',
          tag_name: 'v1.2.0',
          target_commitish: 'c0ffee1',
          name: 'Harbour 1.2.0',
          url: 'https://github.example/acme/harbour/releases/tag/v1.2.0',
          is_draft: false,
          is_prerelease: false,
          created_at: '2026-10-01T09:00:00Z',
          published_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-01T10:00:00Z',
          deleted_at: '2026-10-01T09:30:00Z',
        },
      },
    },
  ]);
});

test('it returns no operations for a deleted fact with no release and no stored row', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.release.deleted',
    at: '2026-10-01T09:30:00Z',
    payload: { action: 'deleted', release: { id: 5 } },
  });

  expect(operations).toStrictEqual([]);
});
