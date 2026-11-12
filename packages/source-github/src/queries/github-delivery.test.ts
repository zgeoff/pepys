import { expect, onTestFinished, test } from 'bun:test';
import { definePlugin, defineQuery, entityIDSchema } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { z } from 'zod';
import { githubDeployConsumer } from '../github-deploy-consumer.ts';
import { githubPlugin } from '../github-plugin.ts';
import { githubPullRequestConsumer } from '../github-pull-request-consumer.ts';
import { githubRefConsumer } from '../github-ref-consumer.ts';
import { githubReleaseConsumer } from '../github-release-consumer.ts';
import { buildDeliveryRows } from '../test-utils/build-delivery-rows.ts';
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
    writeDeliveryRows: async (rows: ReturnType<typeof buildDeliveryRows>) => {
      await store.writeRows(githubPullRequestConsumer, 'github_pull_request', rows.pullRequests);
      await store.writeRows(githubPullRequestConsumer, 'github_release_bump', rows.bumps);
      await store.writeRows(githubReleaseConsumer, 'github_release', rows.releases);
      await store.writeRows(githubRefConsumer, 'github_commit', rows.commits);
      await store.writeRows(githubDeployConsumer, 'github_deploy', rows.deploys);
    },
    readShipped: (pullRequest: string) => store.query(shippedQuery, { pullRequest }),
  };
}

test("it gives another plug-in's query the delivery of a pull request", async () => {
  const ctx = await setupTest();

  await ctx.writeDeliveryRows(buildDeliveryRows());

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
