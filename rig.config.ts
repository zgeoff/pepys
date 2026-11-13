import { defineRig } from '@zgeoff/rig';

export default defineRig({
  // spikes test themselves
  ignore: ['research/**'],
  programs: {
    pepys: {
      package: 'packages/cli',
      source: 'src/bin.ts',
      build: 'bun build src/bin.ts --target=bun --outfile dist/bin.js',
      artifact: 'dist/bin.js',
    },
  },
  lanes: {},
});
