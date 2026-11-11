import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

// The `action` values of GitHub's `issues` webhook event.
const actions = [
  'assigned',
  'closed',
  'deleted',
  'demilestoned',
  'edited',
  'labeled',
  'locked',
  'milestoned',
  'opened',
  'pinned',
  'reopened',
  'transferred',
  'typed',
  'unassigned',
  'unlabeled',
  'unlocked',
  'unpinned',
  'untyped',
] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  issue: z.looseObject({ id: z.number().int() }),
});

// Stored with no consumer.
export const issueFamily = defineFactFamily({
  stream: 'facts.github.issue',
  api: 'github/2022-11-28',
  entityKind: 'github:issue',
  types: buildFamilyTypes('issue', actions, payloadSchema),
});
