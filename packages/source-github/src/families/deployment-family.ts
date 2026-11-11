import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';

const payloadSchema = z.looseObject({ deployment: z.looseObject({ id: z.number().int() }) });

// A deployment and each of its statuses, as facts of the one deployment entity.
export const deploymentFamily = defineFactFamily({
  stream: 'facts.github.deployment',
  api: 'github/2022-11-28',
  entityKind: 'github:deployment',
  types: {
    'github.deployment.created': payloadSchema,
    'github.deployment.status_created': payloadSchema,
  },
});
