import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';

// `cites` is the GitHub ID of a pull request that the voyage names, so the plug-in links across to
// an entity of another plug-in.
export const voyageFamily = defineFactFamily({
  stream: 'facts.logbook.voyage',
  api: 'logbook/1',
  entityKind: 'logbook:voyage',
  types: {
    'logbook.voyage.logged': z.object({
      title: z.string(),
      harbour: z.string(),
      cites: z.number().int().optional(),
    }),
  },
});
