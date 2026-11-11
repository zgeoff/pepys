import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';

const repositorySchema = z.looseObject({ id: z.number().int() });

// A push to the default branch or to a tag. The entity is `github:ref:<repository ID>:<ref>`.
export const refFamily = defineFactFamily({
  stream: 'facts.github.ref',
  api: 'github/2022-11-28',
  entityKind: 'github:ref',
  types: {
    'github.ref.pushed': z.looseObject({ ref: z.string(), repository: repositorySchema }),
  },
});
