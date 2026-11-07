import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { EntityID, FactID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { P, match } from 'ts-pattern';
import { z } from 'zod';
import type { FactLog, StoredFact } from './fact-log.ts';

const streamSchema = z.string().transform((text) => toTagged<StreamName>(text));
const offsetSchema = z.number().transform((value) => toTagged<StreamOffset>(value));
const factIDSchema = z.string().transform((text) => toTagged<FactID>(text));
const entityIDSchema = z.string().transform((text) => toTagged<EntityID>(text));

// The shape of an envelope, and no more, so a fixture can hold one that the envelope parse fails.
const fixtureFactSchema = z.strictObject({
  id: factIDSchema,
  type: z.string(),
  v: z.literal(1),
  api: z.string(),
  entity: entityIDSchema,
  at: z.string(),
  payload: z.json(),
});

const appendSchema = z.strictObject({
  stream: streamSchema,
  expectedTail: offsetSchema,
  fact: fixtureFactSchema,
});

const readSchema = z.strictObject({ stream: streamSchema, from: offsetSchema, count: z.number() });
const readTailSchema = z.strictObject({ stream: streamSchema });

const callSchema = z.union([
  z.strictObject({ append: appendSchema, returns: z.json() }),
  z.strictObject({ read: readSchema, returns: z.json() }),
  z.strictObject({ readTail: readTailSchema, returns: z.json() }),
]);

const fixtureSchema = z.strictObject({
  title: z.string(),
  streams: z.array(streamSchema),
  calls: z.array(callSchema),
});

// The name is the fixture's file name without `.json`.
export type FactLogFixture = z.infer<typeof fixtureSchema> & { name: string };

const fixturesDirectory = join(import.meta.dir, 'fixtures');

export function readFactLogFixtures(): FactLogFixture[] {
  return readdirSync(fixturesDirectory)
    .filter((name) => name.endsWith('.json'))
    .toSorted()
    .map((name) => {
      const json: unknown = JSON.parse(readFileSync(join(fixturesDirectory, name), 'utf8'));

      return Object.assign(fixtureSchema.parse(json), { name: basename(name, '.json') });
    });
}

// Runs each call in turn and returns what each returned, in the fixture's form: a body as the JSON
// it holds, and an appended-at time inside the run as "during-fixture".
export async function runFactLogFixture(log: FactLog, fixture: FactLogFixture): Promise<unknown[]> {
  const startMs = Date.now();
  const returned: unknown[] = [];

  for (const call of fixture.calls) {
    const result = await runCall(log, call, startMs);

    returned.push(result);
  }

  return returned;
}

type FixtureCall = FactLogFixture['calls'][number];

function runCall(log: FactLog, call: FixtureCall, startMs: number): Promise<unknown> {
  return match(call)
    .with({ append: P.select() }, (append) =>
      log.append(append.stream, append.fact, append.expectedTail),
    )
    .with({ readTail: P.select() }, (readTail) => log.readTail(readTail.stream))
    .with({ read: P.select() }, (read) => readFacts(log, read, startMs))
    .exhaustive();
}

type ReadCall = z.infer<typeof readSchema>;

async function readFacts(log: FactLog, read: ReadCall, startMs: number): Promise<unknown> {
  const result = await log.read(read.stream, read.from, read.count);

  const endMs = Date.now();

  return match(result)
    .with({ ok: true }, (found) => ({
      ok: true,
      value: found.value.map((stored) => toFixtureForm(stored, startMs, endMs)),
    }))
    .with({ ok: false }, (failed) => failed)
    .exhaustive();
}

function toFixtureForm(stored: StoredFact, startMs: number, endMs: number) {
  const body: unknown = JSON.parse(stored.body);
  const isDuringFixture = stored.appendedAtMs >= startMs && stored.appendedAtMs <= endMs;

  return {
    offset: stored.offset,
    body,
    appendedAtMs: isDuringFixture ? 'during-fixture' : stored.appendedAtMs,
  };
}
