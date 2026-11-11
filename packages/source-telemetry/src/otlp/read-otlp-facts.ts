import { createHash } from 'node:crypto';
import { parseEntityID } from '@pepys/kit';
import type { LogRecordPayload } from '../log-record-family.ts';
import type { TelemetryProduct } from '../products/types.ts';
import { formatCanonicalJSON } from './format-canonical-json.ts';
import { toAttributeMap } from './to-attribute-map.ts';
import type { AttributeValue, LogRecord, LogsExport, OtlpLogRecord } from './types.ts';

export interface OtlpReadOptions {
  products: readonly TelemetryProduct[];

  // the attribute that holds the session, read from the resource first and from the record second
  sessionAttribute: string;
}

// One fact as a fact batch sender writes it. The read of the route adds the proven sender as the
// payload's `origin`.
export interface TelemetryFact {
  type: string;
  event: string;
  entity: `telemetry:session:${string}`;
  at: string;
  payload: Omit<LogRecordPayload, 'origin'>;
}

// Why a record made no fact. A dropped record never refuses the export it came in.
export type DroppedRecord =
  | { reason: 'unknown-product' }

  // neither the session attribute nor the product's own session attribute has a value
  | { reason: 'no-session'; product: string; event: string }
  | { reason: 'no-time'; product: string; event: string };

export interface OtlpFacts {
  facts: readonly TelemetryFact[];
  dropped: readonly DroppedRecord[];
}

// Pure: one fact per log record of a known product, with an ID that depends on the record alone.
export function readOtlpFacts(body: LogsExport, options: OtlpReadOptions): OtlpFacts {
  const facts: TelemetryFact[] = [];
  const dropped: DroppedRecord[] = [];

  for (const resourceLogs of body.resourceLogs) {
    const resource = toAttributeMap(resourceLogs.resource.attributes);

    for (const scopeLogs of resourceLogs.scopeLogs) {
      for (const raw of scopeLogs.logRecords) {
        const record: LogRecord = {
          scope: { name: scopeLogs.scope.name },
          resource,
          attributes: toAttributeMap(raw.attributes ?? []),
          raw,
        };

        const built = buildFact(record, options);

        if ('reason' in built) {
          dropped.push(built);
        } else {
          facts.push({
            ...built,
            payload: {
              resource: { attributes: [...resourceLogs.resource.attributes] },
              scope: scopeLogs.scope,
              logRecord: raw,
            },
          });
        }
      }
    }
  }

  return { facts, dropped };
}

function buildFact(
  record: LogRecord,
  options: OtlpReadOptions,
): Omit<TelemetryFact, 'payload'> | DroppedRecord {
  const owner = findOwner(record, options.products);

  if (owner === undefined) {
    return { reason: 'unknown-product' };
  }

  const product = owner.product;
  const event = owner.event;
  const attribute = product.agentSessionAttribute;
  const agentSession = toText(record.attributes[attribute]) ?? toText(record.resource[attribute]);

  const session =
    toText(record.resource[options.sessionAttribute]) ??
    toText(record.attributes[options.sessionAttribute]) ??
    agentSession;

  const entity = session === undefined ? undefined : toSessionEntity(session);

  if (entity === undefined) {
    return { reason: 'no-session', product: product.name, event };
  }

  const at = pickTime(record, product.timeAttribute);

  if (at === undefined) {
    return { reason: 'no-time', product: product.name, event };
  }

  const isListed = Object.hasOwn(product.events, event);
  const eventName = `${product.name}.${event}`;
  const key = isListed ? product.events[event]?.key?.(record) : undefined;

  return {
    type: `telemetry.${product.name}.${isListed ? event : 'unlisted'}`,
    event: `${eventName}:${key ?? `h-${buildRecordHash(record.raw, eventName, agentSession)}`}`,
    entity,
    at,
  };
}

function findOwner(
  record: LogRecord,
  list: readonly TelemetryProduct[],
): { product: TelemetryProduct; event: string } | undefined {
  for (const product of list) {
    const event = product.readEvent(record);

    if (event !== undefined) {
      return { product, event };
    }
  }

  return undefined;
}

function toText(value: AttributeValue | undefined): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }

  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toSessionEntity(session: string): `telemetry:session:${string}` | undefined {
  const entity = `telemetry:session:${session}` as const;

  return parseEntityID(entity).ok ? entity : undefined;
}

// The time the product wrote, as ISO text in UTC; never the time ingest read the record.
function pickTime(record: LogRecord, timeAttribute: string): string | undefined {
  const written = record.attributes[timeAttribute];
  const writtenMs = typeof written === 'string' ? Date.parse(written) : Number.NaN;

  if (Number.isFinite(writtenMs)) {
    return toISOTime(writtenMs);
  }

  return toTimeFromNanoseconds(record.raw['timeUnixNano']);
}

// A fact's time is ISO text with a four-digit year, which the envelope check takes.
function toISOTime(timeMs: number): string | undefined {
  const date = new Date(timeMs);

  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }

  const text = date.toISOString();

  return /^\d{4}-/u.test(text) ? text : undefined;
}

const nanosecondsPerMillisecond = 1_000_000n;

// OTLP JSON writes the time as decimal text, and an exporter may write a number; 0 means the time
// is unknown.
function toTimeFromNanoseconds(value: unknown): string | undefined {
  const nanoseconds = toNanoseconds(value);

  if (nanoseconds === undefined || nanoseconds === 0n) {
    return undefined;
  }

  return toISOTime(Number(nanoseconds / nanosecondsPerMillisecond));
}

function toNanoseconds(value: unknown): bigint | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? BigInt(value) : undefined;
  }

  return typeof value === 'string' && /^\d+$/u.test(value) ? BigInt(value) : undefined;
}

// What the product wrote: its own session ID, the event name, the time, the body, and the
// attributes sorted by name. The resource and the observed time stay out, because a sink that
// forwards a record may set both again.
function buildRecordHash(
  raw: OtlpLogRecord,
  eventName: string,
  agentSession: string | undefined,
): string {
  const attributes = (raw.attributes ?? []).toSorted((left, right) =>
    compareText(left.key, right.key),
  );

  const hashed = formatCanonicalJSON([
    agentSession ?? null,
    eventName,
    raw['timeUnixNano'] ?? null,
    raw['body'] ?? null,
    attributes,
  ]);

  return createHash('sha256').update(hashed).digest('hex');
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}
