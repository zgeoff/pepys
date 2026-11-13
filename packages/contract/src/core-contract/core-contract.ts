import { oc } from '@orpc/contract';
import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import { openapi } from '@orpc/openapi';
import { entityIDSchema } from '@pepys/kit';
import { z } from 'zod';

// No schema here has a transform: the MCP input and output schemas are the JSON Schema of these
// zod schemas, and a transform has none.
export const neighbourhoodCaps = {
  depthLimit: { default: 1, max: 3 },
  entityLimit: { default: 50, max: 200 },

  // link rows read per hop; fixed, not an input
  linkReadLimit: 1000,
} as const;

const entitySummarySchema = z.object({
  id: entityIDSchema.describe('The entity ID, as <source>:<kind>:<id>.'),
  kind: z.string().describe('The entity kind, as <source>:<kind>.'),
  title: z.string().describe('A short title for a person to read.'),
  url: z.string().nullable().describe('The page of the entity at its source, when it has one.'),
  actor: entityIDSchema.nullable().describe('The entity ID of who made or owns the entity.'),
  updated_at: z.string().describe('When the entity last changed, as an ISO 8601 time.'),
});

const getEntityInput = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      'The entity ID, as <source>:<kind>:<id>, such as github:pull_request:9001, or an alias of the entity, such as acme/api#412 or https://github.com/acme/api/pull/412 for a pull request.',
    ),
});

const getEntityOutput = z.object({
  entity: entitySummarySchema,
  consumer: z.string().describe('The consumer whose entity view holds the entity.'),
  table: z.string().describe('The table that holds the full row.'),
  row: z
    .record(z.string(), z.unknown())
    .describe('The full row, each column as its declared kind.'),
});

const neighbourhoodInput = z.object({
  id: z.string().describe('The entity to start from, as <source>:<kind>:<id>.'),
  depthLimit: z
    .number()
    .int()
    .min(1)
    .max(neighbourhoodCaps.depthLimit.max)
    .default(neighbourhoodCaps.depthLimit.default)
    .describe('How many links away from the start to walk, from 1 to 3.'),
  entityLimit: z
    .number()
    .int()
    .min(1)
    .max(neighbourhoodCaps.entityLimit.max)
    .default(neighbourhoodCaps.entityLimit.default)
    .describe('The most entities to return, the start included, from 1 to 200.'),
  linkTypes: z
    .array(z.string().min(1))
    .nullable()
    .default(null)
    .describe('The link types to follow; null follows every type.'),
  includeHubs: z
    .boolean()
    .default(false)
    .describe('Whether to follow a hub link type, one that joins many entities.'),
  minimumConfidence: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe('The lowest link confidence to follow, from 0 to 1.'),
});

const neighbourhoodLinkSchema = z.object({
  type: z.string().describe('The link type.'),
  from: entityIDSchema.describe('The entity ID the link starts at.'),
  to: entityIDSchema.describe('The entity ID the link ends at.'),
  direction: z
    .enum(['outgoing', 'incoming'])
    .describe('outgoing when the walk reached the link at its start, incoming at its end.'),
  origin: z.string().describe('The consumer that wrote the link.'),
  confidence: z.number().describe('The confidence of the link, from 0 to 1.'),
  depth: z.number().int().describe('The hop of the walk that followed the link.'),
});

const neighbourhoodEntitySchema = entitySummarySchema.extend({
  depth: z.number().int().describe('How many links away from the start the walk reached it.'),
});

const neighbourhoodOutput = z.object({
  entities: z
    .array(neighbourhoodEntitySchema)
    .describe('The start first, then by depth and ID; only the entities that have a row.'),
  links: z.array(neighbourhoodLinkSchema).describe('Every followed link.'),
  unresolved: z
    .array(entityIDSchema)
    .describe('The IDs the walk reached that no entity view holds.'),
  skippedConsumers: z
    .array(z.string())
    .describe('The consumers with no current version, whose rows and links are left out.'),
  isTruncated: z
    .boolean()
    .describe('true when the entity limit or the read limit of a hop cut the walk short.'),
});

export const coreContract = {
  get_entity: oc
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {}, SERVICE_UNAVAILABLE: {} })
    .meta(
      openapi({
        description:
          'Returns one entity by its ID, such as github:pull_request:9001, or by an alias, such as acme/api#412: its summary, the consumer and table that hold it, and its full row.',
      }),
    )
    .input(getEntityInput)
    .output(getEntityOutput),
  neighbourhood: oc
    .errors({ BAD_REQUEST: {}, NOT_FOUND: {} })
    .meta(
      openapi({
        description:
          'Returns the entities linked to one entity, in both directions, up to 3 links away. It follows a hub link type only when includeHubs is true.',
      }),
    )
    .input(neighbourhoodInput)
    .output(neighbourhoodOutput),
};

export type CoreContract = typeof coreContract;

export type CoreInputs = InferContractRouterInputs<CoreContract>;

export type CoreOutputs = InferContractRouterOutputs<CoreContract>;

// The input a handler gets: parsed, with each default filled in.
export interface CoreParsedInputs {
  get_entity: z.output<typeof getEntityInput>;
  neighbourhood: z.output<typeof neighbourhoodInput>;
}
