import { expect, test } from 'bun:test';
import { createGarageBlobStore } from '@pepys/ingest';
import invariant from 'tiny-invariant';
import {
  readBlobStoreFixtures,
  runBlobStoreFixture,
} from '../packages/ingest/src/blob-store/run-blob-store-fixture.ts';

function setupTest() {
  const endpoint = process.env['PEPYS_GARAGE_ENDPOINT'];
  const region = process.env['PEPYS_GARAGE_REGION'];
  const bucket = process.env['PEPYS_GARAGE_BUCKET'];
  const accessKeyID = process.env['PEPYS_GARAGE_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['PEPYS_GARAGE_SECRET_ACCESS_KEY'];

  invariant(
    endpoint !== undefined &&
      region !== undefined &&
      bucket !== undefined &&
      accessKeyID !== undefined &&
      secretAccessKey !== undefined,
    'start-stack sets the Garage address',
  );

  return {
    store: createGarageBlobStore({ endpoint, region, bucket, accessKeyID, secretAccessKey }),
  };
}

test.each(readBlobStoreFixtures().map((fixture) => [fixture.title, fixture] as const))(
  'it %s, on Garage',
  async (_title, fixture) => {
    const ctx = setupTest();

    const returned = await runBlobStoreFixture(ctx.store, fixture);

    expect(returned).toStrictEqual(fixture.calls.map((call) => call.returns));
  },
);
