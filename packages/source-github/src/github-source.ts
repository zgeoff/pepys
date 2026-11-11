import { defineSource } from '@pepys/kit';
import { deploymentFamily } from './families/deployment-family.ts';
import { issueFamily } from './families/issue-family.ts';
import { pullRequestFamily } from './families/pull-request-family.ts';
import { pullRequestReviewFamily } from './families/pull-request-review-family.ts';
import { refFamily } from './families/ref-family.ts';
import { releaseFamily } from './families/release-family.ts';
import { workflowRunFamily } from './families/workflow-run-family.ts';
import { readGithubDelivery } from './ingest/read-github-delivery.ts';
import { pullFailedDeliveries } from './ingest/recovery/pull-failed-deliveries.ts';
import { pullMarkedObjects } from './ingest/resync/pull-marked-objects.ts';

// The GitHub App that both pulls call the API as.
const appEnv = ['PEPYS_GITHUB_APP_ID', 'PEPYS_GITHUB_APP_PRIVATE_KEY'];

// One webhook route, checked by GitHub's signature, for seven families. The recovery pull reads
// each failed delivery every hour; the resync pull reads each marked object every minute.
export const githubSource = defineSource({
  name: 'github',
  families: [
    pullRequestFamily,
    releaseFamily,
    refFamily,
    deploymentFamily,
    workflowRunFamily,
    issueFamily,
    pullRequestReviewFamily,
  ],
  live: {
    kind: 'receive',
    route: '/webhook/github',
    check: {
      kind: 'hmac-sha256',
      header: 'x-hub-signature-256',
      secretEnv: 'PEPYS_GITHUB_WEBHOOK_SECRET',
    },

    // GitHub calls from the public internet
    reach: 'public',
    read: readGithubDelivery,
  },
  recovery: {
    kind: 'pull',
    name: 'redeliver',
    intervalMs: 3_600_000,
    env: appEnv,
    pull: pullFailedDeliveries,
  },
  resync: {
    kind: 'pull',
    name: 'resync',
    intervalMs: 60_000,
    env: appEnv,
    pull: pullMarkedObjects,
  },
});
