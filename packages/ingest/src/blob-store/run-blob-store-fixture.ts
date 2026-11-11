import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BlobHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { P, match } from 'ts-pattern';
import { z } from 'zod';
import type { BlobStore } from './blob-store.ts';

const hashSchema = z.string().transform((text) => toTagged<BlobHash>(text));
const writeSchema = z.strictObject({ text: z.string() });
const readSchema = z.strictObject({ hash: hashSchema });

const callSchema = z.union([
  z.strictObject({ write: writeSchema, returns: z.json() }),
  z.strictObject({ read: readSchema, returns: z.json() }),
]);

const fixtureSchema = z.strictObject({ title: z.string(), calls: z.array(callSchema) });

export type BlobStoreFixture = z.infer<typeof fixtureSchema>;

const fixturesDirectory = join(import.meta.dir, 'fixtures');

export function readBlobStoreFixtures(): BlobStoreFixture[] {
  return readdirSync(fixturesDirectory)
    .filter((name) => name.endsWith('.json'))
    .toSorted()
    .map((name) => {
      const json: unknown = JSON.parse(readFileSync(join(fixturesDirectory, name), 'utf8'));

      return fixtureSchema.parse(json);
    });
}

// Runs each call in turn and returns what each returned, in the fixture's form: bytes as the UTF-8
// text they hold.
export async function runBlobStoreFixture(
  store: BlobStore,
  fixture: BlobStoreFixture,
): Promise<unknown[]> {
  const returned: unknown[] = [];

  for (const call of fixture.calls) {
    const result = await runCall(store, call);

    returned.push(result);
  }

  return returned;
}

type FixtureCall = BlobStoreFixture['calls'][number];

function runCall(store: BlobStore, call: FixtureCall): Promise<unknown> {
  return match(call)
    .with({ write: P.select() }, (write) => store.write(new TextEncoder().encode(write.text)))
    .with({ read: P.select() }, (read) => readText(store, read.hash))
    .exhaustive();
}

async function readText(store: BlobStore, hash: BlobHash): Promise<unknown> {
  const result = await store.read(hash);

  return match(result)
    .with({ ok: true }, (found) => ({
      ok: true,
      value: { text: new TextDecoder().decode(found.value) },
    }))
    .with({ ok: false }, (failed) => failed)
    .exhaustive();
}
