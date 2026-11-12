import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumerBuildManifestSchema } from '@pepys/schema';

// These tests run scriptc, so they need zig and wasm-tools, which only the e2e job installs.
async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const root = await mkdtemp(join(tmpdir(), 'pepys-build-'));

  stack.defer(() => rm(root, { recursive: true, force: true }));

  const kitURL = import.meta.resolve('@pepys/kit');
  const zodPath = Bun.resolveSync('zod', join(import.meta.dir, '../packages/kit'));

  await mkdir(join(root, 'dep/src/consumers'), { recursive: true });
  await mkdir(join(root, 'app'), { recursive: true });

  await Bun.write(join(root, 'dep/package.json'), '{ "name": "tide-plugin", "type": "module" }');
  await Bun.write(join(root, 'app/package.json'), '{ "name": "tide-app", "type": "module" }');

  return {
    root,
    out: join(root, 'app/build'),
    kitURL,
    zodPath,
    write: (path: string, text: string) => Bun.write(join(root, path), text),
    probeFile: (path: string) => Bun.file(join(root, path)).exists(),
    runBuild: async (file: string) => {
      const child = Bun.spawn(
        [
          'bun',
          join(import.meta.dir, '../packages/cli/src/bin.ts'),
          'build',
          join(root, file),
          '--out',
          join(root, 'app/build'),
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );

      stack.defer(async () => {
        child.kill();

        await child.exited;
      });

      const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);

      return { stderr, exitCode };
    },
    readManifest: async () => {
      const text: unknown = await Bun.file(join(root, 'app/build/consumers.json')).json();

      return consumerBuildManifestSchema.parse(text);
    },
  };
}

test('it compiles a consumer of a dependency from a copy of its src, with no published glue', async () => {
  const ctx = await setupTest();

  await ctx.write(
    'dep/src/plugin.ts',
    `import { defineConsumer, defineFactFamily, definePlugin, defineSource, defineTable } from '${ctx.kitURL}';
import { z } from '${ctx.zodPath}';

const tide = defineFactFamily({
  stream: 'facts.tide.reading',
  api: 'tide/1',
  entityKind: 'tide:gauge',
  types: { 'tide.reading.taken': z.object({ height: z.number() }) },
});

export const tidePlugin = definePlugin({
  name: 'tide',
  sources: [defineSource({ name: 'tide', families: [tide] })],
  consumers: [
    defineConsumer({
      name: 'tide_level',
      entry: new URL('consumers/tide-level.ts', import.meta.url),
      input: { mode: 'fact', streams: [tide.stream] },
      tables: {
        tide_level: defineTable({
          columns: { id: { kind: 'entityID' }, height: { kind: 'real' } },
          primaryKey: ['id'],
          indexes: [],
        }),
      },
      entityViews: [],
      reads: [],
      links: [],
    }),
  ],
});
`,
  );

  await ctx.write(
    'dep/src/consumers/tide-level.ts',
    `import { initTideLevelModel, parseTideLevelFact, toTideGaugeID, updateTideLevelModel } from '../generated/tide-level-boundary.ts';
import type { TideLevelMessage, TideLevelModel, TideLevelOperation } from '../generated/tide-level-boundary.ts';

export type { TideLevelMessage, TideLevelModel } from '../generated/tide-level-boundary.ts';

export function init(): TideLevelModel {
  return initTideLevelModel();
}

export function update(model: TideLevelModel, message: TideLevelMessage): TideLevelModel {
  return updateTideLevelModel(model, message);
}

export function applyFact(factJSON: string): string {
  const fact = parseTideLevelFact(factJSON);
  const operations: TideLevelOperation[] = [];

  if (fact !== undefined) {
    operations.push({ upsert: { tide_level: { id: toTideGaugeID(fact.id), height: fact.payload.height } } });
  }

  return JSON.stringify(operations);
}
`,
  );

  await ctx.write(
    'app/deployment.ts',
    `import { defineDeployment } from '${ctx.kitURL}';
import { tidePlugin } from '../dep/src/plugin.ts';

export const deployment = defineDeployment({ name: 'tide', plugins: [tidePlugin] });
`,
  );

  const result = await ctx.runBuild('app/deployment.ts');
  const manifest = await ctx.readManifest();
  const hasPublishedGlue = await ctx.probeFile('dep/src/generated/tide-level-boundary.ts');

  expect(result).toStrictEqual({ stderr: '', exitCode: 0 });
  expect(manifest.consumers.map((consumer) => consumer.name)).toStrictEqual(['tide_level']);
  expect(hasPublishedGlue).toBeFalse();
});

test('it gives a consumer a new version when a setting of its plug-in changes', async () => {
  const ctx = await setupTest();

  await ctx.write(
    'dep/src/plugin.ts',
    `import { defineConsumer, defineFactFamily, definePlugin, defineSource, defineTable } from '${ctx.kitURL}';
import { z } from '${ctx.zodPath}';

const tide = defineFactFamily({
  stream: 'facts.tide.reading',
  api: 'tide/1',
  entityKind: 'tide:gauge',
  types: { 'tide.reading.taken': z.object({ height: z.number() }) },
});

export const tidePlugin = definePlugin({
  name: 'tide',
  settings: { schema: z.object({ unit: z.string() }), defaults: { unit: 'cm' } },
  sources: [defineSource({ name: 'tide', families: [tide] })],
  consumers: [
    defineConsumer({
      name: 'tide_level',
      entry: new URL('consumers/tide-level.ts', import.meta.url),
      input: { mode: 'fact', streams: [tide.stream] },
      tables: {
        tide_level: defineTable({
          columns: { id: { kind: 'entityID' }, unit: { kind: 'text' } },
          primaryKey: ['id'],
          indexes: [],
        }),
      },
      entityViews: [],
      reads: [],
      links: [],
    }),
  ],
});
`,
  );

  await ctx.write(
    'dep/src/consumers/tide-level.ts',
    `import { initTideLevelModel, parseTideLevelFact, settings, toTideGaugeID, updateTideLevelModel } from '../generated/tide-level-boundary.ts';
import type { TideLevelMessage, TideLevelModel, TideLevelOperation } from '../generated/tide-level-boundary.ts';

export type { TideLevelMessage, TideLevelModel } from '../generated/tide-level-boundary.ts';

export function init(): TideLevelModel {
  return initTideLevelModel();
}

export function update(model: TideLevelModel, message: TideLevelMessage): TideLevelModel {
  return updateTideLevelModel(model, message);
}

export function applyFact(factJSON: string): string {
  const fact = parseTideLevelFact(factJSON);
  const operations: TideLevelOperation[] = [];

  if (fact !== undefined) {
    operations.push({ upsert: { tide_level: { id: toTideGaugeID(fact.id), unit: settings.unit } } });
  }

  return JSON.stringify(operations);
}
`,
  );

  for (const unit of ['cm', 'mm']) {
    await ctx.write(
      `app/deployment-${unit}.ts`,
      `import { defineDeployment } from '${ctx.kitURL}';
import { tidePlugin } from '../dep/src/plugin.ts';

export const deployment = defineDeployment({ name: 'tide', plugins: [tidePlugin], settings: { tide: { unit: '${unit}' } } });
`,
    );
  }

  // the same output folder for every build, because the module hash depends on where it compiles
  await ctx.runBuild('app/deployment-cm.ts');

  const first = await ctx.readManifest();

  await ctx.runBuild('app/deployment-mm.ts');

  const changed = await ctx.readManifest();

  await ctx.runBuild('app/deployment-cm.ts');

  const again = await ctx.readManifest();

  expect(changed.consumers[0]?.version).not.toBe(first.consumers[0]?.version);
  expect(again.consumers[0]?.version).toBe(first.consumers[0]?.version);
});
