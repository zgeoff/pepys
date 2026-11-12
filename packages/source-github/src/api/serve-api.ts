import { serveAPI } from '@pepys/api';
import { defineDeployment } from '@pepys/kit';
import { githubPlugin } from '../github-plugin.ts';

await serveAPI({
  deployment: defineDeployment({ name: 'github', plugins: [githubPlugin] }),
  environment: process.env,
  argv: process.argv.slice(2),
});
