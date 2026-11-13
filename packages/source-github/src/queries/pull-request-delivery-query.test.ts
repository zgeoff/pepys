import { expect, onTestFinished, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import { githubPlugin } from '../github-plugin.ts';
import { githubSource } from '../github-source.ts';
import { pullRequestDeliveryQuery } from './pull-request-delivery-query.ts';

interface DeliveryInput {
  pullRequests: readonly string[];
  environment: string;
  target?: string;
}

async function setupTest() {
  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    store,
    query: (input: DeliveryInput) =>
      store.query(pullRequestDeliveryQuery, { ...input, pullRequests: [...input.pullRequests] }),
  };
}

test.each([
  {
    row: 'production with no target',
    input: { pullRequests: ['github:pull_request:10'], environment: 'production' },
    deploy: {
      id: toTagged<EntityID>('github:deploy:2:production:tag:d1:api'),
      at: '2026-10-01T12:35:00.000Z',
      signal: 'tag',
    },
  },
  {
    row: 'production for the target api',
    input: { pullRequests: ['github:pull_request:10'], environment: 'production', target: 'api' },
    deploy: {
      id: toTagged<EntityID>('github:deploy:2:production:tag:d1:api'),
      at: '2026-10-01T12:35:00.000Z',
      signal: 'tag',
    },
  },
  {
    row: 'production for a target with no deploy',
    input: { pullRequests: ['github:pull_request:10'], environment: 'production', target: 'web' },
    deploy: null,
  },
  {
    row: 'staging, which has deployment status rows only',
    input: { pullRequests: ['github:pull_request:10'], environment: 'staging' },
    deploy: {
      id: toTagged<EntityID>('github:deploy:2:staging:deployment_status:d1'),
      at: '2026-10-01T12:50:00Z',
      signal: 'deployment_status',
    },
  },
])('it ties a merged pull request to its first release and its deploy to $row', async (row) => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.closed',
      event: 'pull_request-10',
      entity: 'github:pull_request:10',
      at: '2026-10-01T10:00:00Z',
      payload: {
        action: 'closed',
        pull_request: {
          id: 10,
          number: 10,
          title: 'A change',
          state: 'closed',
          html_url: 'https://github.example/pull/10',
          user: { id: 9001, type: 'User' },
          base: { repo: { id: 1 } },
          body: null,
          merged: true,
          merge_commit_sha: 'm1',
          created_at: '2026-10-01T08:00:00Z',
          updated_at: '2026-10-01T10:00:00Z',
          closed_at: '2026-10-01T10:00:00Z',
          merged_at: '2026-10-01T10:00:00Z',
        },
      },
    },
    {
      type: 'github.pull_request.closed',
      event: 'pull_request-20',
      entity: 'github:pull_request:20',
      at: '2026-10-01T12:00:00Z',
      payload: {
        action: 'closed',
        pull_request: {
          id: 20,
          number: 20,
          title: 'A change',
          state: 'closed',
          html_url: 'https://github.example/pull/20',
          user: { id: 9001, type: 'Bot' },
          base: { repo: { id: 2 } },
          body: 'Bumps the kit: https://github.com/acme/kit/releases/tag/v1.2.0',
          merged: true,
          merge_commit_sha: 'b1',
          created_at: '2026-10-01T08:00:00Z',
          updated_at: '2026-10-01T12:00:00Z',
          closed_at: '2026-10-01T12:00:00Z',
          merged_at: '2026-10-01T12:00:00Z',
        },
      },
    },
    {
      type: 'github.release.published',
      event: 'release-1-published',
      entity: 'github:release:1',
      at: '2026-10-01T09:05:00Z',
      payload: {
        action: 'published',
        release: {
          id: 1,
          tag_name: 'v1.1.0',
          target_commitish: 'r0',
          name: 'v1.1.0',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.1.0',
          draft: false,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: '2026-10-01T09:05:00Z',
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.release.published',
      event: 'release-2-published',
      entity: 'github:release:2',
      at: '2026-10-01T11:05:00Z',
      payload: {
        action: 'published',
        release: {
          id: 2,
          tag_name: 'v1.2.0',
          target_commitish: 'r1',
          name: 'v1.2.0',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.2.0',
          draft: false,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: '2026-10-01T11:05:00Z',
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.release.created',
      event: 'release-3-created',
      entity: 'github:release:3',
      at: '2026-10-01T08:00:00Z',
      payload: {
        action: 'created',
        release: {
          id: 3,
          tag_name: 'v1.3.0',
          target_commitish: 'r2',
          name: 'v1.3.0',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.3.0',
          draft: true,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: null,
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.release.published',
      event: 'release-4-published',
      entity: 'github:release:4',
      at: '2026-10-01T10:30:00Z',
      payload: {
        action: 'published',
        release: {
          id: 4,
          tag_name: 'v1.3.1',
          target_commitish: 'r2',
          name: 'v1.3.1',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.3.1',
          draft: false,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: '2026-10-01T10:30:00Z',
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.release.deleted',
      event: 'release-4-deleted',
      entity: 'github:release:4',
      at: '2026-10-01T10:40:00Z',
      payload: {
        action: 'deleted',
        release: {
          id: 4,
          tag_name: 'v1.3.1',
          target_commitish: 'r2',
          name: 'v1.3.1',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.3.1',
          draft: false,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: '2026-10-01T10:30:00Z',
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.release.published',
      event: 'release-5-published',
      entity: 'github:release:5',
      at: '2026-10-01T13:05:00Z',
      payload: {
        action: 'published',
        release: {
          id: 5,
          tag_name: 'v1.4.0',
          target_commitish: 'r3',
          name: 'v1.4.0',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.4.0',
          draft: false,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: '2026-10-01T13:05:00Z',
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.ref.pushed',
      event: 'push-1-refs/heads/main-2026-10-01T13:00:00Z',
      entity: 'github:ref:1:refs/heads/main',
      at: '2026-10-01T13:00:00Z',
      payload: {
        ref: 'refs/heads/main',
        repository: { id: 1, default_branch: 'main' },
        commits: [
          { id: 'r0', timestamp: '2026-10-01T11:00:00+02:00' },
          { id: 'm1', timestamp: '2026-10-01T12:00:00+02:00' },
          { id: 'r1', timestamp: '2026-10-01T11:00:00Z' },
          { id: 'r2', timestamp: '2026-10-01T10:20:00Z' },
          { id: 'r3', timestamp: '2026-10-01T13:00:00Z' },
        ],
        head_commit: { id: 'r3', timestamp: '2026-10-01T13:00:00Z' },
      },
    },
    {
      type: 'github.ref.pushed',
      event: 'push-2-refs/heads/main-2026-10-01T12:30:00Z',
      entity: 'github:ref:2:refs/heads/main',
      at: '2026-10-01T12:30:00Z',
      payload: {
        ref: 'refs/heads/main',
        repository: { id: 2, default_branch: 'main' },
        commits: [
          { id: 'd0', timestamp: '2026-10-01T11:30:00Z' },
          { id: 'b1', timestamp: '2026-10-01T12:00:00Z' },
          { id: 'd1', timestamp: '2026-10-01T12:30:00Z' },
        ],
        head_commit: { id: 'd1', timestamp: '2026-10-01T12:30:00Z' },
      },
    },
    {
      type: 'github.ref.pushed',
      event: 'push-2-refs/tags/deployed/production-2026-10-01T11:40:00.000Z',
      entity: 'github:ref:2:refs/tags/deployed/production',
      at: '2026-10-01T11:40:00.000Z',
      payload: {
        ref: 'refs/tags/deployed/production',
        repository: { id: 2, default_branch: 'main' },
        commits: [{ id: 'd0', timestamp: '2026-10-01T11:30:00Z' }],
        head_commit: { id: 'd0', timestamp: '2026-10-01T11:30:00Z' },
      },
    },
    {
      type: 'github.ref.pushed',
      event: 'push-2-refs/tags/deployed/production-2026-10-01T12:40:00.000Z',
      entity: 'github:ref:2:refs/tags/deployed/production',
      at: '2026-10-01T12:40:00.000Z',
      payload: {
        ref: 'refs/tags/deployed/production',
        repository: { id: 2, default_branch: 'main' },
        commits: [{ id: 'd1', timestamp: '2026-10-01T12:30:00Z' }],
        head_commit: { id: 'd1', timestamp: '2026-10-01T12:30:00Z' },
      },
    },
    {
      type: 'github.ref.pushed',
      event: 'push-2-refs/tags/deployed/production/api-2026-10-01T12:35:00.000Z',
      entity: 'github:ref:2:refs/tags/deployed/production/api',
      at: '2026-10-01T12:35:00.000Z',
      payload: {
        ref: 'refs/tags/deployed/production/api',
        repository: { id: 2, default_branch: 'main' },
        commits: [{ id: 'd1', timestamp: '2026-10-01T12:30:00Z' }],
        head_commit: { id: 'd1', timestamp: '2026-10-01T12:30:00Z' },
      },
    },
    {
      type: 'github.deployment.status_created',
      event: 'deployment_status-71',
      entity: 'github:deployment:71',
      at: '2026-10-01T12:20:00Z',
      payload: {
        deployment: { id: 71, environment: 'production', sha: 'd1' },
        deployment_status: { state: 'success' },
        repository: { id: 2 },
      },
    },
    {
      type: 'github.deployment.status_created',
      event: 'deployment_status-72',
      entity: 'github:deployment:72',
      at: '2026-10-01T12:50:00Z',
      payload: {
        deployment: { id: 72, environment: 'staging', sha: 'd1' },
        deployment_status: { state: 'success' },
        repository: { id: 2 },
      },
    },
  ]);

  const result = await ctx.query(row.input);

  expect(result).toStrictEqual([
    {
      pullRequest: toTagged<EntityID>('github:pull_request:10'),
      mergedAt: '2026-10-01T10:00:00Z',
      release: {
        id: toTagged<EntityID>('github:release:2'),
        tag: 'v1.2.0',
        at: '2026-10-01T11:05:00Z',
      },
      deploy: row.deploy,
    },
  ]);
});

test('it gives an open pull request no release and no deploy, and leaves out an unknown one', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.opened',
      event: 'pull_request-11',
      entity: 'github:pull_request:11',
      at: '2026-10-01T08:00:00Z',
      payload: {
        action: 'opened',
        pull_request: {
          id: 11,
          number: 11,
          title: 'A change',
          state: 'open',
          html_url: 'https://github.example/pull/11',
          user: { id: 9001, type: 'User' },
          base: { repo: { id: 1 } },
          body: null,
          merged: false,
          merge_commit_sha: null,
          created_at: '2026-10-01T08:00:00Z',
          updated_at: '2026-10-01T08:00:00Z',
          closed_at: null,
          merged_at: null,
        },
      },
    },
    {
      type: 'github.release.published',
      event: 'release-2-published',
      entity: 'github:release:2',
      at: '2026-10-01T11:05:00Z',
      payload: {
        action: 'published',
        release: {
          id: 2,
          tag_name: 'v1.2.0',
          target_commitish: 'r1',
          name: 'v1.2.0',
          html_url: 'https://github.example/acme/kit/releases/tag/v1.2.0',
          draft: false,
          prerelease: false,
          created_at: '2026-10-01T08:00:00Z',
          published_at: '2026-10-01T11:05:00Z',
        },
        repository: { id: 1, full_name: 'acme/kit' },
      },
    },
    {
      type: 'github.ref.pushed',
      event: 'push-1-refs/heads/main-2026-10-01T11:00:00Z',
      entity: 'github:ref:1:refs/heads/main',
      at: '2026-10-01T11:00:00Z',
      payload: {
        ref: 'refs/heads/main',
        repository: { id: 1, default_branch: 'main' },
        commits: [{ id: 'r1', timestamp: '2026-10-01T11:00:00Z' }],
        head_commit: { id: 'r1', timestamp: '2026-10-01T11:00:00Z' },
      },
    },
  ]);

  const result = await ctx.query({
    pullRequests: ['github:pull_request:11', 'github:pull_request:99'],
    environment: 'production',
  });

  expect(result).toStrictEqual([
    {
      pullRequest: toTagged<EntityID>('github:pull_request:11'),
      mergedAt: null,
      release: null,
      deploy: null,
    },
  ]);
});

test('it leaves out text that is no entity ID and answers for the rest', async () => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.opened',
      event: 'pull_request-11',
      entity: 'github:pull_request:11',
      at: '2026-10-01T08:00:00Z',
      payload: {
        action: 'opened',
        pull_request: {
          id: 11,
          number: 11,
          title: 'A change',
          state: 'open',
          html_url: 'https://github.example/pull/11',
          user: { id: 9001, type: 'User' },
          base: { repo: { id: 1 } },
          body: null,
          merged: false,
          merge_commit_sha: null,
          created_at: '2026-10-01T08:00:00Z',
          updated_at: '2026-10-01T08:00:00Z',
          closed_at: null,
          merged_at: null,
        },
      },
    },
  ]);

  const result = await ctx.query({
    pullRequests: ['pull-11', 'github:pull_request:11'],
    environment: 'production',
  });

  expect(result).toStrictEqual([
    {
      pullRequest: toTagged<EntityID>('github:pull_request:11'),
      mergedAt: null,
      release: null,
      deploy: null,
    },
  ]);
});

test('it answers an empty list with no rows', async () => {
  const ctx = await setupTest();
  const result = await ctx.query({ pullRequests: [], environment: 'production' });

  expect(result).toStrictEqual([]);
});

test('it falls back to the merge time and the release creation time when no push gave the commits', async () => {
  const ctx = await setupTest();

  const release = {
    target_commitish: 'main',
    draft: false,
    prerelease: false,
    html_url: 'https://github.example/acme/tide/releases',
  };

  const repository = { id: 3, full_name: 'acme/tide' };

  await ctx.store.apply(githubSource, [
    {
      type: 'github.pull_request.closed',
      event: 'pull_request-30',
      entity: 'github:pull_request:30',
      at: '2026-10-01T10:00:00Z',
      payload: {
        action: 'closed',
        pull_request: {
          id: 30,
          number: 30,
          title: 'Chart the tide',
          state: 'closed',
          html_url: 'https://github.example/acme/tide/pull/30',
          base: { repo: { id: 3 } },
          merged: true,
          merge_commit_sha: 'unknown-sha',
          created_at: '2026-10-01T08:00:00Z',
          updated_at: '2026-10-01T10:00:00Z',
          closed_at: '2026-10-01T10:00:00Z',
          merged_at: '2026-10-01T10:00:00Z',
        },
      },
    },
    {
      type: 'github.release.published',
      event: 'release-30',
      entity: 'github:release:30',
      at: '2026-10-01T09:00:00Z',
      payload: {
        action: 'published',
        release: {
          ...release,
          id: 30,
          tag_name: 'v0.9.0',
          created_at: '2026-10-01T09:00:00Z',
          published_at: '2026-10-01T09:00:00Z',
        },
        repository,
      },
    },
    {
      type: 'github.release.published',
      event: 'release-31',
      entity: 'github:release:31',
      at: '2026-10-01T10:35:00Z',
      payload: {
        action: 'published',
        release: {
          ...release,
          id: 31,
          tag_name: 'v1.0.0',
          created_at: '2026-10-01T10:30:00Z',
          published_at: '2026-10-01T10:35:00Z',
        },
        repository,
      },
    },
  ]);

  const result = await ctx.query({
    pullRequests: ['github:pull_request:30'],
    environment: 'production',
  });

  expect(result).toStrictEqual([
    {
      pullRequest: toTagged<EntityID>('github:pull_request:30'),
      mergedAt: '2026-10-01T10:00:00Z',
      release: {
        id: toTagged<EntityID>('github:release:31'),
        tag: 'v1.0.0',
        at: '2026-10-01T10:35:00Z',
      },
      deploy: null,
    },
  ]);
});
