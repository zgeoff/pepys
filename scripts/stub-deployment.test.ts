import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConsumerBuildManifest, checkBuildTarget, writeBuildManifest } from '@pepys/cli';
import { consumerBuildManifestSchema } from '@pepys/schema';
import invariant from 'tiny-invariant';
import manifestCases from '../packages/schema/src/consumer-manifest/consumer-manifest-cases.json' with { type: 'json' };
import { stubDeployment } from './stub-deployment.ts';

async function setupTest() {
  const out = await mkdtemp(join(tmpdir(), 'pepys-stub-deployment-'));

  onTestFinished(() => rm(out, { recursive: true, force: true }));

  return {
    out,
    readWritten: () => Bun.file(join(out, 'consumers.json')).text(),
  };
}

// The module hash depends on the folder that scriptc compiles in, so the case gives it, and the
// build gives everything else. The case then cannot part from what the build writes.
test('it writes the stub deployment case byte for byte for the stub deployment', async () => {
  const ctx = await setupTest();

  const stubCase = manifestCases.cases.find(
    (entry) => entry.title === 'accepts the stub deployment',
  );

  invariant(stubCase !== undefined);

  const target = checkBuildTarget({ kind: 'deployment', deployment: stubDeployment });

  invariant(target.ok);

  const modules = consumerBuildManifestSchema.parse(stubCase.file).consumers.map((consumer) => ({
    name: consumer.name,
    module: consumer.module,
    path: consumer.path,
  }));

  await writeBuildManifest(ctx.out, buildConsumerBuildManifest({ target: target.value, modules }));

  const text = await ctx.readWritten();

  expect(text).toBe(`${JSON.stringify(stubCase.file, null, 2)}\n`);
});
