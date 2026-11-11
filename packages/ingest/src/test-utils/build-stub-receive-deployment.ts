import {
  checkDeployment,
  defineDeployment,
  defineFactFamily,
  definePlugin,
  defineSource,
  receiveFactBatch,
} from '@pepys/kit';
import type {
  BlobHash,
  CheckedDeployment,
  Delivery,
  EntityID,
  FactID,
  PendingFact,
  Received,
  SourceDefinition,
  StreamName,
} from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { z } from 'zod';

export interface StubReceiveDeployment {
  deployment: CheckedDeployment;
  ledgerSource: SourceDefinition;
  streams: { till: StreamName; lamp: StreamName; stray: StreamName; strayMark: StreamName };
}

const tillStream = toTagged<StreamName>('facts.ledger.till');
const lampStream = toTagged<StreamName>('facts.beacon.lamp');
const strayStream = toTagged<StreamName>('facts.stray.note');
const strayMarkStream = toTagged<StreamName>('facts.stray.mark');

// Three receive paths that cover every field ingest reads: a signed fact batch with a resync pull, a
// token path with a proven sender, gzip and an ignored route, and a path on two streams whose read
// does what its `x-stray-mode` header asks.
export function buildStubReceiveDeployment(): StubReceiveDeployment {
  const opened = z.object({ float: z.number() });
  const noted = z.object({ note: z.string() });
  const lit = z.object({ level: z.number() });

  const tillFamily = defineFactFamily({
    stream: 'facts.ledger.till',
    api: 'ledger/1',
    entityKind: 'ledger:till',
    types: { 'ledger.till.opened': opened, 'ledger.till.noted': noted },
  });

  const lampFamily = defineFactFamily({
    stream: 'facts.beacon.lamp',
    api: 'beacon/1',
    entityKind: 'beacon:lamp',
    types: { 'beacon.lamp.lit': lit },
  });

  const noteFamily = defineFactFamily({
    stream: 'facts.stray.note',
    api: 'stray/1',
    entityKind: 'stray:note',
    types: { 'stray.note.written': z.object({}) },
  });

  const markFamily = defineFactFamily({
    stream: 'facts.stray.mark',
    api: 'stray/1',
    entityKind: 'stray:mark',
    types: { 'stray.mark.made': z.object({}) },
  });

  const ledgerSource = defineSource({
    name: 'ledger',
    families: [tillFamily],
    live: receiveFactBatch({
      route: '/ledger/facts',
      check: { kind: 'hmac-sha256', header: 'x-ledger-signature-256', secretEnv: 'LEDGER_SECRET' },
      bodyByteLimit: 2_200_000,
      factLimit: 3,
    }),
    resync: {
      kind: 'pull',
      name: 'resync',
      intervalMs: null,

      // one `noted` fact per marked till
      pull: (_cursor, context) =>
        Promise.resolve({
          kind: 'batch',
          batch: { facts: context.marks.map((mark) => buildResyncedTill(mark.entity)) },
          cursor: 'resynced',
          isDone: true,
        }),
    },
  });

  const beaconSource = defineSource({
    name: 'beacon',
    families: [lampFamily],
    live: {
      kind: 'receive',
      route: '/beacon/readings',
      ignoredRoutes: ['/beacon/pings'],
      check: { kind: 'token', header: 'authorization', secretEnv: 'BEACON_TOKEN' },
      bodyByteLimit: 65_536,
      encodings: ['gzip'],
      answer: 'empty',
      sender: {
        kind: 'imp-identity',
        audienceEnv: 'BEACON_AUDIENCE',
        issuersEnv: 'BEACON_ISSUERS',
      },
      read: readBeaconReadings,
    },
  });

  const straySource = defineSource({
    name: 'stray',
    families: [noteFamily, markFamily],
    live: {
      kind: 'receive',
      route: '/stray/notes',
      check: { kind: 'token', header: 'authorization', secretEnv: 'STRAY_TOKEN' },
      read: readStrayNote,
    },
  });

  const deployment = checkDeployment(
    defineDeployment({
      name: 'harbour',
      plugins: [
        definePlugin({ name: 'ledger', sources: [ledgerSource] }),
        definePlugin({ name: 'beacon', sources: [beaconSource] }),
        definePlugin({ name: 'stray', sources: [straySource] }),
      ],
    }),
  );

  invariant(deployment.ok, 'the stub deployment passes the check');

  return {
    deployment: deployment.value,
    ledgerSource,
    streams: { till: tillStream, lamp: lampStream, stray: strayStream, strayMark: strayMarkStream },
  };
}

function buildResyncedTill(entity: EntityID): PendingFact {
  return {
    stream: tillStream,
    blobs: [],
    fact: {
      id: toTagged<FactID>(`event:ledger:resynced-${entity}`),
      type: 'ledger.till.noted',
      v: 1,
      api: 'ledger/1',
      entity,
      at: '2026-10-01T10:00:00Z',
      payload: { note: 'resynced' },
    },
  };
}

const beaconReadingSchema = z.object({
  lamp: z.string(),
  at: z.string(),
  level: z.number(),
  origin: z.unknown().optional(),
});

const beaconExportSchema = z.object({ readings: z.array(beaconReadingSchema) });

// A reader in the shape of the telemetry one: it copies the proven sender into every fact, and
// ignores any origin the body names.
function readBeaconReadings(delivery: Delivery): Received {
  const parsed = beaconExportSchema.safeParse(parseJSONOrNull(delivery.body));

  if (!parsed.success || delivery.sender === undefined) {
    return { kind: 'refused', status: 400, reason: 'not a beacon export' };
  }

  const origin = { issuer: delivery.sender.issuer, subject: delivery.sender.subject };

  const facts = parsed.data.readings.map((reading) => ({
    stream: lampStream,
    blobs: [],
    fact: {
      id: toTagged<FactID>(`event:beacon:${reading.lamp}-${reading.at}`),
      type: 'beacon.lamp.lit',
      v: 1 as const,
      api: 'beacon/1',
      entity: toTagged<EntityID>(`beacon:lamp:${reading.lamp}`),
      at: reading.at,
      payload: { level: reading.level, origin },
    },
  }));

  return { kind: 'batch', batch: { facts } };
}

function parseJSONOrNull(body: Uint8Array): unknown {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));

    return value;
  } catch {
    return null;
  }
}

function readStrayNote(delivery: Delivery): Received {
  const mode = delivery.headers.get('x-stray-mode');

  if (mode === 'throw') {
    throw new Error('the stray reader fails');
  }

  const stream = mode === 'foreign-stream' ? tillStream : strayStream;
  const blob = { hash: toTagged<BlobHash>('a'.repeat(64)), bytes: new Uint8Array(1) };
  const blobs = mode === 'blob' ? [blob] : [];

  const fact = {
    id: toTagged<FactID>('event:stray:note-1'),
    type: 'stray.note.written',
    v: 1 as const,
    api: 'stray/1',
    entity: toTagged<EntityID>('stray:note:1'),
    at: '2026-10-01T08:00:00Z',
    payload: {},
  };

  const mark = {
    id: toTagged<FactID>('event:stray:mark-1'),
    type: 'stray.mark.made',
    v: 1 as const,
    api: 'stray/1',
    entity: toTagged<EntityID>('stray:mark:1'),
    at: '2026-10-01T08:00:00Z',
    payload: {},
  };

  // 'two-streams': one fact on each of the source's two streams
  const marks = mode === 'two-streams' ? [{ stream: strayMarkStream, blobs: [], fact: mark }] : [];

  return { kind: 'batch', batch: { facts: [{ stream, blobs, fact }, ...marks] } };
}
