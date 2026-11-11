import { definePlugin, defineSource } from '@pepys/kit';
import { githubPullRequestConsumer } from './github-pull-request-consumer.ts';
import { readPullRequestDelivery } from './ingest/read-pull-request-delivery.ts';
import { pullRequestFamily } from './pull-request-family.ts';

export const githubPlugin = definePlugin({
  name: 'github',
  sources: [
    defineSource({
      name: 'github',
      families: [pullRequestFamily],
      live: {
        kind: 'receive',
        route: '/webhook',
        check: {
          kind: 'hmac-sha256',
          header: 'x-hub-signature-256',
          secretEnv: 'PEPYS_GITHUB_WEBHOOK_SECRET',
        },
        reach: 'public',
        read: readPullRequestDelivery,
      },
    }),
  ],
  consumers: [githubPullRequestConsumer],
});
