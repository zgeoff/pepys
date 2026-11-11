import { definePlugin } from '@pepys/kit';
import { githubSettings } from './github-settings.ts';
import { githubSource } from './github-source.ts';
import { githubDeliveryConsumers } from './queries/github-delivery-consumers.ts';
import { pullRequestDeliveryQuery } from './queries/pull-request-delivery-query.ts';

// One plug-in for every deployment. A deployment that uses another tag pattern sets
// `settings.github.deployTagPattern` in its deployment file.
export const githubPlugin = definePlugin({
  name: 'github',
  settings: githubSettings,
  sources: [githubSource],
  consumers: [...githubDeliveryConsumers],
  queries: [pullRequestDeliveryQuery],
});
