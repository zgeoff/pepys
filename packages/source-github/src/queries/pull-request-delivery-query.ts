import { defineQuery, entityIDSchema, isEntityID } from '@pepys/kit';
import { z } from 'zod';
import { deploySignals } from '../utils/deploy-signals.ts';
import { githubDeliveryConsumers } from './github-delivery-consumers.ts';
import {
  parsePullRequestDeliveries,
  selectPullRequestDelivery,
} from './select-pull-request-delivery.ts';

const pullRequestsSchema = z.array(z.string()).max(200);
const nameSchema = z.string().min(1);
const releaseSchema = z.object({ id: entityIDSchema, tag: z.string(), at: z.string() });
const signalSchema = z.enum(deploySignals);
const deploySchema = z.object({ id: entityIDSchema, at: z.string(), signal: signalSchema });

const deliverySchema = z.object({
  pullRequest: entityIDSchema,
  mergedAt: z.string().nullable(),
  release: releaseSchema.nullable(),
  deploy: deploySchema.nullable(),
});

export const pullRequestDeliveryQuery = defineQuery({
  name: 'github_pull_request_delivery',
  description:
    'Returns, for each pull request, when it merged, the first release of its repository that contains it, and the first deploy to one environment of a commit that pins such a release. With a target, only a deploy of that target counts. A pull request with no row is left out.',
  input: z.object({
    pullRequests: pullRequestsSchema,
    environment: nameSchema,
    target: nameSchema.optional(),
  }),
  output: z.array(deliverySchema),
  reads: githubDeliveryConsumers,
  handler: async (call) => {
    // text that is no entity ID names no stored pull request, so it has no row either way
    const [first, ...rest] = call.input.pullRequests.filter((id) => isEntityID(id));

    if (first === undefined) {
      return [];
    }

    const result = await selectPullRequestDelivery({
      pullRequests: [first, ...rest],
      environment: call.input.environment,
      target: call.input.target,
    }).execute(call.db);

    return parsePullRequestDeliveries(result.rows);
  },
});
