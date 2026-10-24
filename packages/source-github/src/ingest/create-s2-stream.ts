import { S2, S2Error } from '@s2-dev/streamstore';
import type { S2Stream, StreamConfig } from '@s2-dev/streamstore';

interface S2StreamParameters {
  endpoint: string;
  accessToken: string;
  basin: string;
  stream: string;
}

// log.md: pepys creates every stream with infinite retention, because the default is 7 days.
const infiniteRetention: StreamConfig = { retentionPolicy: { infinite: {} } };

// Creates the basin and the stream when they are missing and returns the stream. A stream that
// exists keeps its records and has its retention set to infinite.
export async function createS2Stream(parameters: S2StreamParameters): Promise<S2Stream> {
  const client = new S2({
    accessToken: parameters.accessToken,
    endpoints: { account: parameters.endpoint, basin: parameters.endpoint },
    requestTimeoutMillis: 5000,

    // The fact appender owns retries; a client retry could store a record twice before it knows.
    retry: { maxAttempts: 1 },
  });

  await ignoreExisting(client.basins.create({ basin: parameters.basin }));

  const basin = client.basin(parameters.basin);

  const isCreated = await ignoreExisting(
    basin.streams.create({ stream: parameters.stream, config: infiniteRetention }),
  );

  if (!isCreated) {
    await basin.streams.reconfigure({ stream: parameters.stream, ...infiniteRetention });
  }

  return basin.stream(parameters.stream);
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
