import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VersionHash } from '@pepys/kit';
import type { ConsumerBuildManifest } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { writeBuildManifest } from './write-build-manifest.ts';

async function setupTest() {
  const out = await mkdtemp(join(tmpdir(), 'pepys-manifest-'));

  onTestFinished(() => rm(out, { recursive: true, force: true }));

  return {
    out,
    probeWritten: () => Bun.file(join(out, 'consumers.json')).exists(),
    readWritten: () => Bun.file(join(out, 'consumers.json')).text(),
  };
}

test('it writes consumers.json as JSON with two-space indents and returns its path', async () => {
  const ctx = await setupTest();

  const hash = toTagged<VersionHash>('a'.repeat(64));

  const manifest: ConsumerBuildManifest = {
    kit: 1,
    deployment: 'harbour',
    consumers: [
      {
        name: 'tide_log',
        module: hash,
        path: `tide_log/${hash}.wasm`,
        pins: {},
        version: hash,
        manifest: {
          name: 'tide_log',
          input: { mode: 'fact', streams: ['facts.harbour.tide'] },
          exports: { init: 'tide_log_init', apply: 'tide_log_apply_fact' },
          imports: [],
          tables: {
            tide_reading: {
              columns: { id: { kind: 'entityID', nullable: false } },
              primaryKey: ['id'],
              indexes: [],
            },
          },
          links: [],
          schema: 'CREATE TABLE "tide_reading" ("id" TEXT NOT NULL);\n',
        },
      },
    ],
  };

  const written = await writeBuildManifest(ctx.out, manifest);

  expect(written).toStrictEqual({ ok: true, value: join(ctx.out, 'consumers.json') });

  const text = await ctx.readWritten();

  expect(text).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
});

test('it writes nothing and names the problem for a table name that the host reserves', async () => {
  const ctx = await setupTest();

  const hash = toTagged<VersionHash>('a'.repeat(64));

  const written = await writeBuildManifest(ctx.out, {
    kit: 1,
    deployment: 'harbour',
    consumers: [
      {
        name: 'tide_log',
        module: hash,
        path: `tide_log/${hash}.wasm`,
        pins: {},
        version: hash,
        manifest: {
          name: 'tide_log',
          input: { mode: 'fact', streams: ['facts.harbour.tide'] },
          exports: { init: 'tide_log_init', apply: 'tide_log_apply_fact' },
          imports: [],
          tables: {
            entity: {
              columns: { id: { kind: 'entityID', nullable: false } },
              primaryKey: ['id'],
              indexes: [],
            },
          },
          links: [],
          schema: 'CREATE TABLE "entity" ("id" TEXT NOT NULL);\n',
        },
      },
    ],
  });

  expect(written).toStrictEqual({
    ok: false,
    failure: [expect.stringContaining('the table name entity is reserved for the host')],
  });

  const isWritten = await ctx.probeWritten();

  expect(isWritten).toBeFalse();
});
