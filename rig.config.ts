import { defineRig } from '@zgeoff/rig';

export default defineRig({
  // the same folders as bunfig.toml's pathIgnorePatterns, for the reason it gives
  ignore: ['research/**', 'e2e/**'],
  lanes: {},
});
