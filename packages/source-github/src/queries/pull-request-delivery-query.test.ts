import { expect, onTestFinished, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import { githubPlugin } from '../github-plugin.ts';
import { githubSource } from '../github-source.ts';
import { buildDeliveryFacts } from '../test-utils/build-delivery-facts.ts';
import { pullRequestDeliveryQuery } from './pull-request-delivery-query.ts';

interface DeliveryInput {
  pullRequests: string[];
  environment: string;
  target?: string;
}

async function setupTest() {
  const store = await createTestStore({ plugins: [githubPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    store,
    query: (input: DeliveryInput) => store.query(pullRequestDeliveryQuery, input),
  };
}

test.each([
  {
    row: 'production with no target',
    environment: 'production',
    target: undefined,
    deploy: {
      id: toTagged<EntityID>('github:deploy:2:production:tag:d1:api'),
      at: '2026-10-01T12:35:00.000Z',
      signal: 'tag',
    },
  },
  {
    row: 'production for the target api',
    environment: 'production',
    target: 'api',
    deploy: {
      id: toTagged<EntityID>('github:deploy:2:production:tag:d1:api'),
      at: '2026-10-01T12:35:00.000Z',
      signal: 'tag',
    },
  },
  {
    row: 'production for a target with no deploy',
    environment: 'production',
    target: 'web',
    deploy: null,
  },
  {
    row: 'staging, which has deployment status rows only',
    environment: 'staging',
    target: undefined,
    deploy: {
      id: toTagged<EntityID>('github:deploy:2:staging:deployment_status:d1'),
      at: '2026-10-01T12:50:00Z',
      signal: 'deployment_status',
    },
  },
])('it ties a merged pull request to its first release and its deploy to $row', async (row) => {
  const ctx = await setupTest();

  await ctx.store.apply(githubSource, buildDeliveryFacts());

  const result = await ctx.query({
    pullRequests: ['github:pull_request:10'],
    environment: row.environment,
    ...(row.target === undefined ? {} : { target: row.target }),
  });

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

  await ctx.store.apply(githubSource, buildDeliveryFacts());

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

  await ctx.store.apply(githubSource, buildDeliveryFacts());

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

  await ctx.store.apply(githubSource, buildDeliveryFacts());

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
