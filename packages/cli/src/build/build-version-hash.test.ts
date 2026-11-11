import { expect, test } from 'bun:test';
import type { VersionHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildVersionHash } from './build-version-hash.ts';

test('it hashes the module, the pins and the manifest as JSON with sorted keys', () => {
  const version = buildVersionHash({
    module: toTagged<VersionHash>('a'.repeat(64)),
    pins: {},
    manifest: {
      name: 'tide_log',
      input: { mode: 'fact', streams: ['facts.harbour.tide'] },
      exports: { init: 'tide_log_init', apply: 'tide_log_apply_fact' },
      imports: [],
      tables: {},
      links: [],
      schema: 'CREATE TABLE "tide_reading" ("id" TEXT NOT NULL);\n',
    },
  });

  const sortedText = [
    '{"manifest":{',
    '"exports":{"apply":"tide_log_apply_fact","init":"tide_log_init"},',
    '"imports":[],',
    '"input":{"mode":"fact","streams":["facts.harbour.tide"]},',
    '"links":[],',
    '"name":"tide_log",',
    String.raw`"schema":"CREATE TABLE \"tide_reading\" (\"id\" TEXT NOT NULL);\n",`,
    '"tables":{}},',
    `"module":"${'a'.repeat(64)}",`,
    '"pins":{}}',
  ].join('');

  expect<string>(version).toBe(new Bun.CryptoHasher('sha256').update(sortedText).digest('hex'));
});

test('it gives a new version for the same module with a changed manifest', () => {
  const parts = {
    module: toTagged<VersionHash>('a'.repeat(64)),
    pins: {},
    manifest: {
      name: 'tide_log',
      input: { mode: 'fact' as const, streams: ['facts.harbour.tide' as const] },
      exports: { init: 'tide_log_init', apply: 'tide_log_apply_fact' },
      imports: [],
      tables: {},
      links: [],
      schema: 'CREATE TABLE "tide_reading" ("id" TEXT NOT NULL);\n',
    },
  };

  const first = buildVersionHash(parts);

  const second = buildVersionHash({
    ...parts,
    manifest: {
      ...parts.manifest,
      schema: `${parts.manifest.schema}CREATE INDEX "x" ON "y" ("z");\n`,
    },
  });

  expect(second).not.toBe(first);
});
