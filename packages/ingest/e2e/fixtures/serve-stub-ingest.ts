// Starts ingest on the stub receive deployment, then stops it. `STUB_PLUGINS` picks the plug-ins:
// `twice` lists each one twice, and `timed-pull` adds a source whose live pull runs on a timer and
// holds the stop until its first run.

import { defineFactFamily, definePlugin, defineSource } from '@pepys/kit';
import { z } from 'zod';
import { serveIngest } from '../../src/serve/serve-ingest.ts';
import { buildStubReceiveDeployment } from '../../src/test-utils/build-stub-receive-deployment.ts';

const definition = buildStubReceiveDeployment().definition;
const pulled = Promise.withResolvers<void>();

const tideFamily = defineFactFamily({
  stream: 'facts.almanac.tide',
  api: 'almanac/1',
  entityKind: 'almanac:tide',
  types: { 'almanac.tide.turned': z.object({}) },
});

const almanac = definePlugin({
  name: 'almanac',
  sources: [
    defineSource({
      name: 'almanac',
      families: [tideFamily],
      live: {
        kind: 'pull',
        name: 'tides',
        intervalMs: 10,
        pull: () => {
          pulled.resolve();

          return Promise.resolve({
            kind: 'batch',
            batch: { facts: [] },
            cursor: 'tide-41',
            isDone: true,
          });
        },
      },
    }),
  ],
});

const pluginsByChoice = {
  twice: [...definition.plugins, ...definition.plugins],
  'timed-pull': [...definition.plugins, almanac],
};

const choice = process.env['STUB_PLUGINS'];

const stop = await serveIngest({
  deployment: {
    ...definition,
    plugins:
      choice === 'twice' || choice === 'timed-pull' ? pluginsByChoice[choice] : definition.plugins,
  },
  environment: process.env,
  exitOnSignal: false,
});

if (choice === 'timed-pull') {
  await pulled.promise;
}

await stop();
