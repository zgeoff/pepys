import { buildEventFactID } from '@pepys/kit';
import type {
  DeliveryCheck,
  EntityID,
  FactFamily,
  PendingFact,
  ReceivePath,
  Received,
  Sender,
  SourceContext,
  StreamName,
} from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { parseLogsExport } from './parse-logs-export.ts';
import { readOtlpFacts } from './read-otlp-facts.ts';
import type { DroppedRecord, OtlpReadOptions, TelemetryFact } from './read-otlp-facts.ts';

type OtlpLogsReceiver = Pick<
  ReceivePath,
  | 'route'
  | 'ignoredRoutes'
  | 'bodyByteLimit'
  | 'factLimit'
  | 'encodings'
  | 'answer'
  | 'reach'
  | 'sender'
> &
  OtlpReadOptions & { check: DeliveryCheck };

// The receive path of OTLP/HTTP logs in JSON. Ingest has checked the method, the size, the token
// and the sender, and has unpacked a gzip body, before `read` sees the export.
export function receiveOtlpLogs(receiver: OtlpLogsReceiver): ReceivePath {
  const { products, sessionAttribute, ...path } = receiver;

  return {
    ...path,
    kind: 'receive',
    read: (delivery, source) => {
      if (!isJSONContentType(delivery.headers.get('content-type'))) {
        return {
          kind: 'refused',
          status: 400,
          reason: 'the body must be OTLP JSON, with the content type application/json',
        };
      }

      const body = parseLogsExport(parseJSON(new TextDecoder().decode(delivery.body)));

      if (body === undefined) {
        return { kind: 'refused', status: 400, reason: 'the body is no OTLP logs export' };
      }

      // ingest calls `read` on a path with a `sender` only once a sender is proven
      invariant(delivery.sender !== undefined, 'a telemetry export always has a proven sender');

      const read = readOtlpFacts(body, { products, sessionAttribute });

      if (read.dropped.length > 0) {
        source.log.warn(
          `the source ${source.name} dropped log records`,
          countDropped(read.dropped),
        );
      }

      return buildReceived(read.facts, delivery.sender, source);
    },
  };
}

function isJSONContentType(contentType: string | null): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

function parseJSON(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);

    return value;
  } catch {
    return undefined;
  }
}

// One line per export: the count of each reason, never the records.
function countDropped(dropped: readonly DroppedRecord[]): Record<string, number> {
  const counts = new Map<string, number>();

  for (const record of dropped) {
    counts.set(record.reason, (counts.get(record.reason) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
}

function buildReceived(
  facts: readonly TelemetryFact[],
  sender: Sender,
  source: SourceContext,
): Received {
  if (facts.length === 0) {
    return { kind: 'ignored' };
  }

  const pending: PendingFact[] = [];

  for (const fact of facts) {
    const family = findFamily(source.families, fact.type);

    invariant(family !== undefined, `the source has a family for ${fact.type}`);

    pending.push({
      stream: toTagged<StreamName>(family.stream),
      fact: {
        id: buildEventFactID({ source: source.name, event: fact.event }),
        type: fact.type,
        v: 1,
        api: family.api,
        entity: toTagged<EntityID>(fact.entity),
        at: fact.at,
        payload: { ...fact.payload, origin: { issuer: sender.issuer, subject: sender.subject } },
      },
      blobs: [],
    });
  }

  return { kind: 'batch', batch: { facts: pending } };
}

function findFamily(families: readonly FactFamily[], type: string): FactFamily | undefined {
  return families.find((family) => Object.hasOwn(family.types, type));
}
