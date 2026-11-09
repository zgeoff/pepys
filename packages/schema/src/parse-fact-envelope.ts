import { toTagged } from '@zgeoff/std';
import { z } from 'zod';
import type { EntityID, FactID } from './ids/types.ts';
import { parseEntityID } from './parse-entity-id.ts';
import type { FactEnvelope, Result } from './types.ts';

const factIDPattern = new RegExp(
  ['^webhook:[a-z][a-z0-9_]*:.+$', '^(?:observation|enrichment|manual):[0-9a-f]{64}$']
    .map((pattern) => `(?:${pattern})`)
    .join('|'),
  'u',
);

const factIDSchema = z
  .string()
  .regex(factIDPattern, 'not a fact ID')
  .transform((text) => toTagged<FactID>(text));

const entityIDSchema = z
  .string()
  .refine((text) => parseEntityID(text).ok, 'not an entity ID')
  .transform((text) => toTagged<EntityID>(text));

const factEnvelopeSchema = z.strictObject({
  id: factIDSchema,
  type: z.string().min(1),
  v: z.literal(1),
  api: z.string().min(1),
  entity: entityIDSchema,
  actor: entityIDSchema.optional(),
  at: z.iso.datetime(),
  cursor: z.string().optional(),
  payload: z.unknown().refine((payload) => payload !== undefined, 'a fact needs a payload'),
});

export function parseFactEnvelope(input: unknown): Result<FactEnvelope<unknown>, z.ZodError> {
  const parsed = factEnvelopeSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, failure: parsed.error };
  }

  return { ok: true, value: parsed.data };
}
