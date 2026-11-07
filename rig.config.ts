import { defineRig } from '@zgeoff/rig';

export default defineRig({
  // spikes test themselves, and the e2e lane needs the stack that `test:e2e` starts
  ignore: ['research/**', 'e2e/**'],
  lanes: {},
});
