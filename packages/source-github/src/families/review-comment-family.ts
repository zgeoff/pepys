import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

// The `action` values of GitHub's `pull_request_review_comment` webhook event.
const actions = ['created', 'deleted', 'edited'] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  comment: z.looseObject({ id: z.number().int() }),
});

export const reviewCommentFamily = defineFactFamily({
  stream: 'facts.github.review_comment',
  api: 'github/2022-11-28',
  entityKind: 'github:review_comment',
  types: buildFamilyTypes('review_comment', actions, payloadSchema),
});
