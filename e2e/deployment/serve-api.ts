import { serveAPI } from '@pepys/api';
import { e2eDeployment } from './e2e-deployment.ts';

serveAPI({ deployment: e2eDeployment, environment: process.env });
