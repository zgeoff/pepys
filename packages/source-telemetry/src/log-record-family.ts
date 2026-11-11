import { defineFactFamily } from '@pepys/kit';
import { z } from 'zod';
import { products } from './products/products.ts';
import type { TelemetryProduct } from './products/types.ts';

const keyValueSchema = z.object({ key: z.string(), value: z.unknown() });

// What the exporter wrote, whole, and the proven sender. The glue types the attribute lists and the
// origin; an attribute's value is an OTLP union, which a consumer narrows itself.
export const logRecordPayloadSchema = z.object({
  resource: z.object({ attributes: z.array(keyValueSchema) }),
  scope: z.object({ name: z.string(), version: z.string().optional() }),
  logRecord: z.looseObject({ attributes: z.array(keyValueSchema).optional() }),

  // The only part of the payload that the sender did not write: ingest copies it from the proof.
  // It is not in the fact ID, which depends on the record alone.
  origin: z.object({ issuer: z.string(), subject: z.string() }),
});

export type LogRecordPayload = z.infer<typeof logRecordPayloadSchema>;

// `telemetry.<product>.<event>` for each listed event, and `telemetry.<product>.unlisted`.
export function buildLogRecordTypes(
  list: readonly TelemetryProduct[],
): Readonly<Record<string, typeof logRecordPayloadSchema>> {
  const entries = list.flatMap((product) =>
    [...Object.keys(product.events), 'unlisted'].map(
      (event) => [`telemetry.${product.name}.${event}`, logRecordPayloadSchema] as const,
    ),
  );

  return Object.fromEntries(entries);
}

// One family and one stream: one log record of a known product is one fact, stored whole.
export const logRecordFamily = defineFactFamily({
  stream: 'facts.telemetry.log_record',
  api: 'otlp-logs/1',
  entityKind: 'telemetry:session',
  types: buildLogRecordTypes(products),
});
