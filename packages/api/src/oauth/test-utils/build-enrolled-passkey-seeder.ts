import { seedEnrolledPasskey } from './seed-enrolled-passkey.ts';
import type { EnrolledPasskeyDeps, EnrolledPasskeyInput } from './seed-enrolled-passkey.ts';

export function buildEnrolledPasskeySeeder(deps: EnrolledPasskeyDeps) {
  return {
    enrolledPasskey: (input: EnrolledPasskeyInput) => seedEnrolledPasskey(deps, input),
  };
}
