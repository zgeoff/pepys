import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { readBuildTools } from './read-build-tools.ts';

test('it points scriptc at the wasm32-wasi runtime pack of its own version', async () => {
  const tools = readBuildTools();

  const scriptcText = await Bun.file(join(dirname(tools.scriptc), '../package.json')).text();

  const runtimePack: unknown = await Bun.file(
    join(tools.scriptcRuntimePack, 'runtime-pack.json'),
  ).json();

  const scriptcPackage = z.object({ version: z.string() }).parse(JSON.parse(scriptcText));

  expect(runtimePack).toMatchObject({
    target: { name: 'wasm32-wasi' },
    version: scriptcPackage.version,
  });
});
