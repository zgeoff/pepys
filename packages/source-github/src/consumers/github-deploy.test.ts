import { expect, test } from 'bun:test';
import { createStubHostRead } from '@pepys/kit/test-utils/create-stub-host-read';
import { applyFact } from './github-deploy.ts';

function setupTest() {
  const rows = new Map<string, string>();

  createStubHostRead('GithubDeploy', rows);

  return { rows, apply: (fact: unknown): unknown => JSON.parse(applyFact(JSON.stringify(fact))) };
}

test('it upserts a tag deploy for a tag of the default pattern', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.ref.pushed',
    at: '2026-10-01T09:00:00.000Z',
    payload: {
      ref: 'refs/tags/deployed/production',
      head_commit: { id: 'c0ffee1' },
      repository: { id: 902 },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_deploy: {
          id: 'github:deploy:902:production:tag:c0ffee1',
          repository_id: 'github:repo:902',
          environment: 'production',
          target: null,
          sha: 'c0ffee1',
          signal: 'tag',
          deployed_at: '2026-10-01T09:00:00.000Z',
        },
      },
    },
  ]);
});

test('it reads the target from one more part of the tag', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.ref.pushed',
    at: '2026-10-01T09:00:00.000Z',
    payload: {
      ref: 'refs/tags/deployed/production/api',
      head_commit: { id: 'c0ffee1' },
      repository: { id: 902 },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_deploy: {
          id: 'github:deploy:902:production:tag:c0ffee1:api',
          repository_id: 'github:repo:902',
          environment: 'production',
          target: 'api',
          sha: 'c0ffee1',
          signal: 'tag',
          deployed_at: '2026-10-01T09:00:00.000Z',
        },
      },
    },
  ]);
});

test('it upserts a deployment status deploy for a success', () => {
  const ctx = setupTest();

  const operations = ctx.apply({
    type: 'github.deployment.status_created',
    at: '2026-10-01T09:02:00Z',
    payload: {
      deployment_status: { state: 'success' },
      deployment: { id: 31, environment: 'staging', sha: 'beef42' },
      repository: { id: 902 },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_deploy: {
          id: 'github:deploy:902:staging:deployment_status:beef42',
          repository_id: 'github:repo:902',
          environment: 'staging',
          target: null,
          sha: 'beef42',
          signal: 'deployment_status',
          deployed_at: '2026-10-01T09:02:00Z',
        },
      },
    },
  ]);
});

test.each([
  {
    row: 'a tag outside the pattern',
    fact: {
      type: 'github.ref.pushed',
      at: '2026-10-01T09:00:00Z',
      payload: { ref: 'refs/tags/v1.2.0', head_commit: { id: 'c1' }, repository: { id: 902 } },
    },
  },
  {
    row: 'a tag with two more parts',
    fact: {
      type: 'github.ref.pushed',
      at: '2026-10-01T09:00:00Z',
      payload: {
        ref: 'refs/tags/deployed/production/api/extra',
        head_commit: { id: 'c1' },
        repository: { id: 902 },
      },
    },
  },
  {
    row: 'a push that deletes the tag',
    fact: {
      type: 'github.ref.pushed',
      at: '2026-10-01T09:00:00Z',
      payload: {
        ref: 'refs/tags/deployed/production',
        deleted: true,
        head_commit: null,
        repository: { id: 902 },
      },
    },
  },
  {
    row: 'a push to a branch',
    fact: {
      type: 'github.ref.pushed',
      at: '2026-10-01T09:00:00Z',
      payload: { ref: 'refs/heads/main', head_commit: { id: 'c1' }, repository: { id: 902 } },
    },
  },
  {
    row: 'a deployment status that is not a success',
    fact: {
      type: 'github.deployment.status_created',
      at: '2026-10-01T09:02:00Z',
      payload: {
        deployment_status: { state: 'failure' },
        deployment: { id: 31, environment: 'staging', sha: 'beef42' },
        repository: { id: 902 },
      },
    },
  },
  {
    row: 'a deployment with no status',
    fact: {
      type: 'github.deployment.created',
      at: '2026-10-01T09:00:00Z',
      payload: { deployment: { id: 31, environment: 'staging', sha: 'beef42' } },
    },
  },
])('it returns no operations for $row', (row) => {
  const ctx = setupTest();

  expect(ctx.apply(row.fact)).toStrictEqual([]);
});

test('it keeps the stored row when it has the earlier time', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:deploy:902:production:tag:c0ffee1',
    JSON.stringify({
      id: 'github:deploy:902:production:tag:c0ffee1',
      repository_id: 'github:repo:902',
      environment: 'production',
      target: null,
      sha: 'c0ffee1',
      signal: 'tag',
      deployed_at: '2026-10-01T08:00:00.000Z',
    }),
  );

  const operations = ctx.apply({
    type: 'github.ref.pushed',
    at: '2026-10-01T09:00:00.000Z',
    payload: {
      ref: 'refs/tags/deployed/production',
      head_commit: { id: 'c0ffee1' },
      repository: { id: 902 },
    },
  });

  expect(operations).toStrictEqual([]);
});

test('it moves the stored row to an earlier time', () => {
  const ctx = setupTest();

  ctx.rows.set(
    'github:deploy:902:production:tag:c0ffee1',
    JSON.stringify({
      id: 'github:deploy:902:production:tag:c0ffee1',
      repository_id: 'github:repo:902',
      environment: 'production',
      target: null,
      sha: 'c0ffee1',
      signal: 'tag',
      deployed_at: '2026-10-01T10:00:00.000Z',
    }),
  );

  const operations = ctx.apply({
    type: 'github.ref.pushed',
    at: '2026-10-01T09:00:00.000Z',
    payload: {
      ref: 'refs/tags/deployed/production',
      head_commit: { id: 'c0ffee1' },
      repository: { id: 902 },
    },
  });

  expect(operations).toStrictEqual([
    {
      upsert: {
        github_deploy: {
          id: 'github:deploy:902:production:tag:c0ffee1',
          repository_id: 'github:repo:902',
          environment: 'production',
          target: null,
          sha: 'c0ffee1',
          signal: 'tag',
          deployed_at: '2026-10-01T09:00:00.000Z',
        },
      },
    },
  ]);
});
