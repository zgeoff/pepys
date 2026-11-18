import { expect, test } from 'bun:test';
import { isCachedBin } from './is-cached-bin.ts';

test.each([
  ['/tmp/bunx-1000-@pepys/source-telemetry@0.4.4/node_modules/x/src/forwarder-bin.ts', true],
  ['/home/owner/.bun/install/global/node_modules/x/src/forwarder-bin.ts', false],
])('#isCachedBin gives the verdict for %s', (path, verdict) => {
  expect(isCachedBin(path)).toBe(verdict);
});
