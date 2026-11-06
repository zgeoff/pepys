import { oc } from '@orpc/contract';
import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import { parseEntityID } from '@pepys/schema';
import type { EntityID, FactID, Reference, RequestID } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { z } from 'zod';

const entityIDSchema = z.string().transform((text, ctx) => {
  const parsed = parseEntityID(text);

  if (!parsed.ok) {
    ctx.issues.push({
      code: 'custom',
      message: `not an entity ID: ${parsed.failure.reason}`,
      input: text,
    });

    return z.NEVER;
  }

  return toTagged<EntityID>(text);
});

const nameSchema = z.string().min(1);
const nameListSchema = z.array(nameSchema).nullable();

const entitySummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  url: z.string(),
  actor: z.string().nullable(),
  updated_at: z.string(),
});

const getEntityInput = z.object({ id: entityIDSchema });

const getEntityOutput = z.object({
  entity: entitySummarySchema,
  row: z.record(z.string(), z.unknown()),
  aliases: z.array(z.string()),
});

const referenceSchema = nameSchema.transform((text) => toTagged<Reference>(text));

const linkTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), id: entityIDSchema }),
  z.object({ kind: z.literal('reference'), reference: referenceSchema }),
]);

const linkEndsSchema = z.object({ type: nameSchema, from: entityIDSchema, to: linkTargetSchema });

const neighbourhoodInput = z.object({
  id: entityIDSchema,
  depthLimit: z.number().int().min(1).max(3),
  linkTypes: nameListSchema,
  includeHubs: z.boolean(),
  minimumConfidence: z.number().min(0).max(1),
});

const neighbourhoodLinkSchema = linkEndsSchema.extend({
  direction: z.enum(['outgoing', 'incoming']),
  confidence: z.number(),
  depth: z.number().int(),
});

const neighbourhoodOutput = z.object({
  entities: z.array(entitySummarySchema),
  links: z.array(neighbourhoodLinkSchema),
});

const searchInput = z.object({
  text: nameSchema,
  kinds: nameListSchema,
  limit: z.number().int().min(1).max(100),
});

const searchResultSchema = z.object({ entity: entitySummarySchema, rank: z.number() });
const searchOutput = z.object({ results: z.array(searchResultSchema) });
const entityHistoryInput = z.object({ id: entityIDSchema, field: nameSchema.nullable() });

const transitionSchema = z.object({
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  earliestAt: z.string(),
  latestAt: z.string(),
  fidelity: z.enum(['event', 'observed']),
});

const entityHistoryOutput = z.object({ transitions: z.array(transitionSchema) });
const requestIDSchema = nameSchema.transform((text) => toTagged<RequestID>(text));

const assertLinkInput = linkEndsSchema.extend({
  requestID: requestIDSchema,
  confidence: z.number().min(0).max(1),
  evidence: nameSchema,
});

const factIDSchema = z.string().transform((text) => toTagged<FactID>(text));
const factOutput = z.object({ fact: factIDSchema });
const retractLinkInput = linkEndsSchema.extend({ requestID: requestIDSchema, reason: nameSchema });

const correctLabelInput = z.object({
  requestID: requestIDSchema,
  entity: entityIDSchema,
  job: nameSchema,
  label: nameSchema,
});

export const coreContract = {
  get_entity: oc
    .route({
      description:
        "Returns one entity by its ID, such as github:pr:1874433021: its row in the owning consumer's entity view, its full row, and the references that resolve to it.",
    })
    .input(getEntityInput)
    .output(getEntityOutput),
  neighbourhood: oc
    .route({
      description:
        'Returns the entities linked to one entity, in both directions, up to a depth of 3. It skips hub kinds such as people unless includeHubs is true.',
    })
    .input(neighbourhoodInput)
    .output(neighbourhoodOutput),
  search: oc
    .route({
      description:
        'Returns the entities that match a text, ranked by full-text and vector search together.',
    })
    .input(searchInput)
    .output(searchOutput),
  entity_history: oc
    .route({
      description:
        "Returns one entity's transitions, each marked event when the source recorded it or observed when pepys saw it change.",
    })
    .input(entityHistoryInput)
    .output(entityHistoryOutput),
  assert_link: oc
    .route({
      description:
        'Asserts a link between two entities, with a confidence from 0 to 1 and the evidence for it. The link records the calling client as its origin.',
    })
    .input(assertLinkInput)
    .output(factOutput),
  retract_link: oc
    .route({
      description: 'Retracts a link between two entities, whoever asserted it, with the reason.',
    })
    .input(retractLinkInput)
    .output(factOutput),
  correct_label: oc
    .route({
      description:
        "Corrects the label that an enrichment job gave an entity. The correction counts as labelled data for the job's next version.",
    })
    .input(correctLabelInput)
    .output(factOutput),
};

export type CoreContract = typeof coreContract;

export type CoreInputs = InferContractRouterInputs<CoreContract>;

export type CoreOutputs = InferContractRouterOutputs<CoreContract>;
