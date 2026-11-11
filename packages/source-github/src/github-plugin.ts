import { definePlugin, defineSource } from '@pepys/kit';
import { githubPullRequestConsumer } from './github-pull-request-consumer.ts';
import { pullRequestFamily } from './pull-request-family.ts';

export const githubPlugin = definePlugin({
  name: 'github',
  sources: [defineSource({ name: 'github', families: [pullRequestFamily] })],
  consumers: [githubPullRequestConsumer],
});
