import { z } from 'zod';
import { buildDeliverySummary } from './build-delivery-summary.ts';
import { readAppDeliveries } from './read-app-deliveries.ts';

const environmentSchema = z.object({
  PEPYS_GITHUB_CLIENT_ID: z.string().min(1),
  PEPYS_GITHUB_APP_PRIVATE_KEY_PATH: z.string().min(1),
});

const environment = environmentSchema.parse(process.env);

const privateKeyPEM = await Bun.file(environment.PEPYS_GITHUB_APP_PRIVATE_KEY_PATH).text();

const deliveries = await readAppDeliveries({
  clientID: environment.PEPYS_GITHUB_CLIENT_ID,
  privateKeyPEM,
});

const summary = buildDeliverySummary(deliveries, new Date());

console.log(JSON.stringify(summary, null, 2));
