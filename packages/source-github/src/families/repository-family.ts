import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

// The `action` values of GitHub's `repository` webhook event.
const actions = [
  'archived',
  'created',
  'deleted',
  'edited',
  'privatized',
  'publicized',
  'renamed',
  'transferred',
  'unarchived',
] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  repository: z.looseObject({ id: z.number().int() }),
});

export const repositoryFamily = defineFactFamily({
  stream: 'facts.github.repository',
  api: 'github/2022-11-28',
  entityKind: 'github:repo',
  types: buildFamilyTypes('repository', actions, payloadSchema),
});
