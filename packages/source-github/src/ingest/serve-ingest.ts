import { serveIngest } from '@pepys/ingest';
import { defineDeployment } from '@pepys/kit';
import { githubPlugin } from '../github-plugin.ts';

await serveIngest({
  deployment: defineDeployment({ name: 'github', plugins: [githubPlugin] }),
  environment: process.env,
});
