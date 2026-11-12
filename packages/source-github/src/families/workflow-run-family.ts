import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

const actions = ['completed', 'in_progress', 'requested'] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  workflow_run: z.looseObject({ id: z.number().int() }),
});

export const workflowRunFamily = defineFactFamily({
  stream: 'facts.github.workflow_run',
  api: 'github/2022-11-28',
  entityKind: 'github:workflow_run',
  types: buildFamilyTypes('workflow_run', actions, payloadSchema),
});
