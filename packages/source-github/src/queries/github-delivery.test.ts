import { expect, onTestFinished, test } from 'bun:test';
import { definePlugin, defineQuery, entityIDSchema } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { z } from 'zod';
import { githubPlugin } from '../github-plugin.ts';
import { githubSource } from '../github-source.ts';
import { githubDelivery } from './github-delivery.ts';

async function setupTest() {
  const shippedQuery = defineQuery({
    name: 'slipway_shipped',
    description: 'The delivery of one pull request to production.',
    input: z.object({ pullRequest: entityIDSchema }),
    output: z.array(z.unknown()),
    reads: githubDelivery.consumers,
    handler: async (call) => {
      const result = await githubDelivery
        .select({ pullRequests: [call.input.pullRequest], environment: 'production' })
        .execute(call.db);

      return githubDelivery.parse(result.rows);
    },
  });

  const slipwayPlugin = definePlugin({ name: 'slipway', queries: [shippedQuery] });

  const store = await createTestStore({ plugins: [githubPlugin, slipwayPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    store,
    readShipped: (pullRequest: string) => store.query(shippedQuery, { pullRequest }),
  };
}

test("it gives another plug-in's query the delivery of a pull request", async () => {
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
        commits: [
          { id: 'm1', timestamp: '2026-10-01T10:00:00Z' },
          { id: 'r1', timestamp: '2026-10-01T11:00:00Z' },
        ],
        head_commit: { id: 'r1', timestamp: '2026-10-01T11:00:00Z' },
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
          { id: 'b1', timestamp: '2026-10-01T12:00:00Z' },
          { id: 'd1', timestamp: '2026-10-01T12:30:00Z' },
        ],
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
  ]);

  const result = await ctx.readShipped('github:pull_request:10');

  expect(result).toStrictEqual([
    {
      pullRequest: 'github:pull_request:10',
      mergedAt: '2026-10-01T10:00:00Z',
      release: { id: 'github:release:2', tag: 'v1.2.0', at: '2026-10-01T11:05:00Z' },
      deploy: {
        id: 'github:deploy:2:production:tag:d1:api',
        at: '2026-10-01T12:35:00.000Z',
        signal: 'tag',
      },
    },
  ]);
});
