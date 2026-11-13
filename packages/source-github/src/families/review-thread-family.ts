import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

// The `action` values of GitHub's `pull_request_review_thread` webhook event.
const actions = ['resolved', 'unresolved'] as const;
const commentSchema = z.looseObject({ id: z.number().int() });

const payloadSchema = z.looseObject({
  action: z.string(),
  thread: z.looseObject({ comments: z.array(commentSchema) }),
});

export const reviewThreadFamily = defineFactFamily({
  stream: 'facts.github.review_thread',
  api: 'github/2022-11-28',
  entityKind: 'github:review_thread',
  types: buildFamilyTypes('review_thread', actions, payloadSchema),
});
