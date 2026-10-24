import { buildWebhookFactID, parseFactEnvelope } from '@pepys/schema';
import type { FactEnvelope, Result } from '@pepys/schema';
import { z } from 'zod';
import type { ZodError } from 'zod';

interface PullRequestFactParameters {
  deliveryID: string;
  body: unknown;
}

const pullRequestBodySchema = z.looseObject({
  action: z.string().min(1),
  pull_request: z.looseObject({ id: z.number().int(), updated_at: z.string() }),
  sender: z.looseObject({ id: z.number().int() }).optional(),
});

export function buildPullRequestFact(
  parameters: PullRequestFactParameters,
): Result<FactEnvelope<unknown>, ZodError> {
  const parsed = pullRequestBodySchema.safeParse(parameters.body);

  if (!parsed.success) {
    return { ok: false, failure: parsed.error };
  }

  const body = parsed.data;

  return parseFactEnvelope({
    id: buildWebhookFactID({ source: 'github', deliveryID: parameters.deliveryID }),
    type: `github.pull_request.${body.action}`,
    v: 1,
    api: 'github/2022-11-28',
    entity: `github:pr:${body.pull_request.id}`,
    ...(body.sender === undefined ? {} : { actor: `github:user:${body.sender.id}` }),
    at: body.pull_request.updated_at,
    payload: parameters.body,
  });
}
