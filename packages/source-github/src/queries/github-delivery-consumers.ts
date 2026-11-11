import { githubDeployConsumer } from '../github-deploy-consumer.ts';
import { githubPullRequestConsumer } from '../github-pull-request-consumer.ts';
import { githubRefConsumer } from '../github-ref-consumer.ts';
import { githubReleaseConsumer } from '../github-release-consumer.ts';

// The consumers whose tables the delivery query reads. A query of another plug-in that calls the
// query module passes these in its `reads`.
export const githubDeliveryConsumers = [
  githubPullRequestConsumer,
  githubReleaseConsumer,
  githubRefConsumer,
  githubDeployConsumer,
] as const;
