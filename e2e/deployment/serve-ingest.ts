import { serveIngest } from '@pepys/ingest';
import { e2eDeployment } from './e2e-deployment.ts';

await serveIngest({ deployment: e2eDeployment, environment: process.env });
