import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';

// The `action` values of GitHub's `pull_request` webhook event.
const actions = [
  'assigned',
  'auto_merge_disabled',
  'auto_merge_enabled',
  'closed',
  'converted_to_draft',
  'demilestoned',
  'dequeued',
  'edited',
  'enqueued',
  'labeled',
  'locked',
  'milestoned',
  'opened',
  'ready_for_review',
  'reopened',
  'review_request_removed',
  'review_requested',
  'synchronize',
  'unassigned',
  'unlabeled',
  'unlocked',
] as const;

const deliverySchema = z.looseObject({
  action: z.string(),
  pull_request: z.looseObject({ id: z.number().int(), updated_at: z.string() }),
});

export const pullRequestFamily = defineFactFamily({
  stream: 'facts.github.pull_request',
  api: 'github/2022-11-28',
  entityKind: 'github:pull_request',
  types: Object.fromEntries(
    actions.map((action) => [`github.pull_request.${action}`, deliverySchema]),
  ),
});
