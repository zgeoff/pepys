import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

// The `action` values of GitHub's `issue_comment` webhook event, which covers the conversation
// comments of both issues and pull requests.
const actions = ['created', 'deleted', 'edited', 'pinned', 'unpinned'] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  comment: z.looseObject({ id: z.number().int() }),
});

export const issueCommentFamily = defineFactFamily({
  stream: 'facts.github.issue_comment',
  api: 'github/2022-11-28',
  entityKind: 'github:issue_comment',
  types: buildFamilyTypes('issue_comment', actions, payloadSchema),
});
