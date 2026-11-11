import { expect, test } from 'bun:test';
import { applyFact } from './github-ref.ts';

function setupTest() {
  return { apply: (fact: unknown) => JSON.parse(applyFact(JSON.stringify(fact))) };
}

test('it upserts one commit row per commit of a push to the default branch', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.ref.pushed',
    payload: {
      ref: 'refs/heads/main',
      repository: { id: 902, default_branch: 'main' },
      commits: [
        { id: 'a1', timestamp: '2026-10-01T09:00:00+02:00' },
        { id: 'b2', timestamp: '2026-10-01T09:01:00+02:00' },
      ],
      head_commit: { id: 'b2', timestamp: '2026-10-01T09:01:00+02:00' },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_commit: {
          repository_id: 'github:repo:902',
          sha: 'a1',
          committed_at: '2026-10-01T09:00:00+02:00',
        },
      },
    },
    {
      upsert: {
        github_commit: {
          repository_id: 'github:repo:902',
          sha: 'b2',
          committed_at: '2026-10-01T09:01:00+02:00',
        },
      },
    },
  ]);
});

test('it upserts the commit that a pushed tag names', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.ref.pushed',
    payload: {
      ref: 'refs/tags/deployed/production',
      repository: { id: 902, default_branch: 'main' },
      commits: [],
      head_commit: { id: 'c3', timestamp: '2026-10-01T09:02:00Z' },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_commit: {
          repository_id: 'github:repo:902',
          sha: 'c3',
          committed_at: '2026-10-01T09:02:00Z',
        },
      },
    },
  ]);
});

test.each([
  {
    row: 'a push to another branch',
    payload: {
      ref: 'refs/heads/feature',
      repository: { id: 902, default_branch: 'main' },
      commits: [{ id: 'a1', timestamp: '2026-10-01T09:00:00Z' }],
    },
  },
  {
    row: 'a push that deletes a tag',
    payload: {
      ref: 'refs/tags/deployed/production',
      repository: { id: 902, default_branch: 'main' },
      commits: [],
      head_commit: null,
    },
  },
])('it returns no operations for $row', (row) => {
  const ctx = setupTest();

  expect(ctx.apply({ type: 'github.ref.pushed', payload: row.payload })).toStrictEqual([]);
});
