import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

const actions = ['dismissed', 'edited', 'submitted'] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  review: z.looseObject({ id: z.number().int() }),
});

export const pullRequestReviewFamily = defineFactFamily({
  stream: 'facts.github.pull_request_review',
  api: 'github/2022-11-28',
  entityKind: 'github:pull_request_review',
  types: buildFamilyTypes('pull_request_review', actions, payloadSchema),
});
