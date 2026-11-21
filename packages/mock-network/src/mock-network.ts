import { createTestNetwork } from '@zgeoff/testing/fetch';

// The one mock network of a pepys test process. The test preload lists this module, so its hooks
// cover every test file. A request to a loopback host passes, so a test can call a server it
// starts; a request to any other host that no handler matches fails the test.
export const mockNetwork = createTestNetwork({ handlers: [] });
