import { defineSource } from '@pepys/kit';
import { deploymentFamily } from './families/deployment-family.ts';
import { issueFamily } from './families/issue-family.ts';
import { pullRequestFamily } from './families/pull-request-family.ts';
import { pullRequestReviewFamily } from './families/pull-request-review-family.ts';
import { refFamily } from './families/ref-family.ts';
import { releaseFamily } from './families/release-family.ts';
import { workflowRunFamily } from './families/workflow-run-family.ts';
import { readGithubDelivery } from './ingest/read-github-delivery.ts';

// One webhook route, checked by GitHub's signature, for seven families.
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
});
