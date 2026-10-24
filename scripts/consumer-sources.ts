import type { ConsumerDeclaration } from '@pepys/schema';
import { githubPullRequestConsumer } from '@pepys/source-github';

interface ConsumerSource {
  directory: string;
  consumers: ConsumerDeclaration[];
}

// Each source package brings its consumers' declarations; none is found by walking the disk.
export const consumerSources: ConsumerSource[] = [
  { directory: 'packages/source-github', consumers: [githubPullRequestConsumer] },
];
