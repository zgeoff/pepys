import type { Plugin } from '@pepys/kit';
import { githubPlugin } from '@pepys/source-github';

interface ConsumerSource {
  directory: string;
  plugin: Plugin;
}

// Each source package brings its plug-in; no consumer is found by walking the disk.
export const consumerSources: ConsumerSource[] = [
  { directory: 'packages/source-github', plugin: githubPlugin },
];
