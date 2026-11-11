import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { buildFamilyTypes } from './build-family-types.ts';

// The `action` values of GitHub's `release` webhook event, and `resynced` for a release that the
// resync pull read from the API. The resync pull gives `deleted` for a release the API no longer has.
const actions = [
  'created',
  'deleted',
  'edited',
  'prereleased',
  'published',
  'released',
  'resynced',
  'unpublished',
] as const;

const payloadSchema = z.looseObject({
  action: z.string(),
  release: z.looseObject({ id: z.number().int() }),
});

export const releaseFamily = defineFactFamily({
  stream: 'facts.github.release',
  api: 'github/2022-11-28',
  entityKind: 'github:release',
  types: buildFamilyTypes('release', actions, payloadSchema),
});
