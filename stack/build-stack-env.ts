import type { RunningStack } from './with-stack.ts';

// The variables a test reads the stack's addresses from.
export function buildStackEnv(stack: RunningStack): Record<string, string> {
  return {
    PEPYS_S2_ENDPOINT: stack.s2Endpoint,
    PEPYS_S2_ACCESS_TOKEN: stack.s2AccessToken,
    PEPYS_S2_BASIN: stack.s2Basin,
    PEPYS_GARAGE_ENDPOINT: stack.garage.endpoint,
    PEPYS_GARAGE_REGION: stack.garage.region,
    PEPYS_GARAGE_BUCKET: stack.garage.blobsBucket,
    PEPYS_GARAGE_ACCESS_KEY_ID: stack.garage.accessKeyID,
    PEPYS_GARAGE_SECRET_ACCESS_KEY: stack.garage.secretAccessKey,
  };
}
