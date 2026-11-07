import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/schema';
import {
  AppendInput,
  AppendRecord,
  RangeNotSatisfiableError,
  S2,
  S2Error,
} from '@s2-dev/streamstore';
import type { S2Basin, StreamConfig } from '@s2-dev/streamstore';
import { toTagged } from '@zgeoff/std';
import type { AppendOutcome, FactLog, StoredFact } from '../fact-log.ts';
import { parseStoredFact } from '../parse-stored-fact.ts';
import { toStoredBody } from '../to-stored-body.ts';
import { findAppendOutcome, isUnknownStream } from './find-append-outcome.ts';

interface S2FactLogParameters {
  endpoint: string;
  accessToken: string;
  basin: string;
  streams: readonly StreamName[];
}

// Creates the basin and the streams when they are missing. A stream that exists keeps its records
// and has its retention set to infinite.
export async function createS2FactLog(parameters: S2FactLogParameters): Promise<FactLog> {
  const options = {
    accessToken: parameters.accessToken,
    endpoints: { account: parameters.endpoint, basin: parameters.endpoint },
    requestTimeoutMillis: 5000,
  };

  const client = new S2(options);

  // A client retry could store a record twice before the writer knows; the writer owns retries.
  const appendClient = new S2({ ...options, retry: { maxAttempts: 1 } });

  await ignoreExisting(client.basins.create({ basin: parameters.basin }));

  const basin = client.basin(parameters.basin);
  const appendBasin = appendClient.basin(parameters.basin);

  for (const stream of parameters.streams) {
    await createInfiniteStream(basin, stream);
  }

  return {
    append: (stream, fact, expectedTail) => appendFact(appendBasin, stream, fact, expectedTail),
    read: (stream, from, count) => readFacts(basin, stream, from, count),
    readTail: (stream) => readTail(basin, stream),
  };
}

async function ignoreExisting(creation: Promise<unknown>): Promise<boolean> {
  try {
    await creation;

    return true;
  } catch (error: unknown) {
    if (error instanceof S2Error && error.status === 409) {
      return false;
    }

    throw error;
  }
}

// log.md: pepys creates every stream with infinite retention, because the default is 7 days.
const infiniteRetention: StreamConfig = { retentionPolicy: { infinite: {} } };

async function createInfiniteStream(basin: S2Basin, stream: StreamName): Promise<void> {
  const isCreated = await ignoreExisting(
    basin.streams.create({ stream, config: infiniteRetention }),
  );

  if (!isCreated) {
    await basin.streams.reconfigure({ stream, ...infiniteRetention });
  }
}

async function appendFact(
  basin: S2Basin,
  stream: StreamName,
  fact: FactEnvelope<unknown>,
  expectedTail: StreamOffset,
): Promise<AppendOutcome> {
  const body = toStoredBody(fact);

  if (body === null) {
    return { kind: 'rejected', reason: 'invalid-envelope' };
  }

  const input = AppendInput.create([AppendRecord.string({ body })], {
    matchSeqNum: expectedTail,
  });

  try {
    const ack = await basin.stream(stream).append(input);

    return { kind: 'acknowledged', offset: toTagged<StreamOffset>(ack.start.seqNum) };
  } catch (error: unknown) {
    const outcome = findAppendOutcome(error);

    if (outcome === null) {
      throw error;
    }

    return outcome;
  }
}

type StreamRead<Value> = Result<Value, { reason: 'unknown-stream' }>;

async function readFacts(
  basin: S2Basin,
  stream: StreamName,
  from: StreamOffset,
  count: number,
): Promise<StreamRead<readonly StoredFact[]>> {
  try {
    const batch = await basin
      .stream(stream)
      .read({ start: { from: { seqNum: from } }, stop: { limits: { count } } });

    return {
      ok: true,
      value: batch.records.map((record) =>
        parseStoredFact(
          toTagged<StreamOffset>(record.seqNum),
          record.body,
          record.timestamp.getTime(),
        ),
      ),
    };
  } catch (error: unknown) {
    // s2-lite answers 416 to a read that starts at the tail or past it.
    if (error instanceof RangeNotSatisfiableError) {
      return { ok: true, value: [] };
    }

    if (isUnknownStream(error)) {
      return { ok: false, failure: { reason: 'unknown-stream' } };
    }

    throw error;
  }
}

async function readTail(basin: S2Basin, stream: StreamName): Promise<StreamRead<StreamOffset>> {
  try {
    const response = await basin.stream(stream).checkTail();

    return { ok: true, value: toTagged<StreamOffset>(response.tail.seqNum) };
  } catch (error: unknown) {
    if (isUnknownStream(error)) {
      return { ok: false, failure: { reason: 'unknown-stream' } };
    }

    throw error;
  }
}
