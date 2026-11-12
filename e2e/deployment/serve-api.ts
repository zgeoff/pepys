import { serveAPI } from '@pepys/api';
import { e2eDeployment } from './e2e-deployment.ts';

await serveAPI({
  deployment: e2eDeployment,
  environment: process.env,
  argv: process.argv.slice(2),
});
