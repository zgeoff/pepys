import { expect, onTestFinished, test } from 'bun:test';
import { createTestStore } from '@pepys/testing';
import { githubDeployConsumer } from '../github-deploy-consumer.ts';
import { githubPlugin } from '../github-plugin.ts';
import { githubPullRequestConsumer } from '../github-pull-request-consumer.ts';
import { githubRefConsumer } from '../github-ref-consumer.ts';
import { githubReleaseConsumer } from '../github-release-consumer.ts';
import {
  buildDeliveryRows,
  buildPullRequestRow,
  buildReleaseRow,
} from '../test-utils/build-delivery-rows.ts';
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
    writeDeliveryRows: async (rows: ReturnType<typeof buildDeliveryRows>) => {
      await store.writeRows(githubPullRequestConsumer, 'github_pull_request', rows.pullRequests);
      await store.writeRows(githubPullRequestConsumer, 'github_release_bump', rows.bumps);
      await store.writeRows(githubReleaseConsumer, 'github_release', rows.releases);
      await store.writeRows(githubRefConsumer, 'github_commit', rows.commits);
      await store.writeRows(githubDeployConsumer, 'github_deploy', rows.deploys);
    },
    query: (input: DeliveryInput) => store.query(pullRequestDeliveryQuery, input),
  };
}

test.each([
  {
    row: 'production with no target',
    environment: 'production',
    target: undefined,
    deploy: {
      id: 'github:deploy:2:production:tag:d1:api',
      at: '2026-10-01T12:35:00.000Z',
      signal: 'tag',
    },
  },
  {
    row: 'production for the target api',
    environment: 'production',
    target: 'api',
    deploy: {
      id: 'github:deploy:2:production:tag:d1:api',
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
      id: 'github:deploy:2:staging:deployment_status:d1',
      at: '2026-10-01T12:50:00Z',
      signal: 'deployment_status',
    },
  },
])('it ties a merged pull request to its first release and its deploy to $row', async (row) => {
  const ctx = await setupTest();

  await ctx.writeDeliveryRows(buildDeliveryRows());

  const result = await ctx.query({
    pullRequests: ['github:pull_request:10'],
    environment: row.environment,
    ...(row.target === undefined ? {} : { target: row.target }),
  });

  expect(result).toStrictEqual([
    {
      pullRequest: 'github:pull_request:10',
      mergedAt: '2026-10-01T10:00:00Z',
      release: { id: 'github:release:2', tag: 'v1.2.0', at: '2026-10-01T11:05:00Z' },
      deploy: row.deploy,
    },
  ]);
});

test('it gives an open pull request no release and no deploy, and leaves out an unknown one', async () => {
  const ctx = await setupTest();

  await ctx.writeDeliveryRows(buildDeliveryRows());

  const result = await ctx.query({
    pullRequests: ['github:pull_request:11', 'github:pull_request:99'],
    environment: 'production',
  });

  expect(result).toStrictEqual([
    { pullRequest: 'github:pull_request:11', mergedAt: null, release: null, deploy: null },
  ]);
});

test('it answers an empty list with no rows', async () => {
  const ctx = await setupTest();

  await ctx.writeDeliveryRows(buildDeliveryRows());

  const result = await ctx.query({ pullRequests: [], environment: 'production' });

  expect(result).toStrictEqual([]);
});

test('it falls back to the merge time and the release creation time when no push gave the commits', async () => {
  const ctx = await setupTest();

  await ctx.store.writeRows(githubPullRequestConsumer, 'github_pull_request', [
    buildPullRequestRow({
      id: 'github:pull_request:30',
      repository: 'github:repo:3',
      mergeSha: 'unknown-sha',
      mergedAt: '2026-10-01T10:00:00Z',
    }),
  ]);

  await ctx.store.writeRows(githubReleaseConsumer, 'github_release', [
    buildReleaseRow({
      id: 'github:release:30',
      repository: 'github:repo:3',
      repositoryName: 'acme/tide',
      tag: 'v0.9.0',
      target: 'main',
      isDraft: false,
      createdAt: '2026-10-01T09:00:00Z',
      publishedAt: '2026-10-01T09:00:00Z',
      deletedAt: null,
    }),
    buildReleaseRow({
      id: 'github:release:31',
      repository: 'github:repo:3',
      repositoryName: 'acme/tide',
      tag: 'v1.0.0',
      target: 'main',
      isDraft: false,
      createdAt: '2026-10-01T10:30:00Z',
      publishedAt: '2026-10-01T10:35:00Z',
      deletedAt: null,
    }),
  ]);

  const result = await ctx.query({
    pullRequests: ['github:pull_request:30'],
    environment: 'production',
  });

  expect(result).toStrictEqual([
    {
      pullRequest: 'github:pull_request:30',
      mergedAt: '2026-10-01T10:00:00Z',
      release: { id: 'github:release:31', tag: 'v1.0.0', at: '2026-10-01T10:35:00Z' },
      deploy: null,
    },
  ]);
});
