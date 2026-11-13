import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import type { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { runPasskeyEnrollment } from './run-passkey-enrollment.ts';
import type { MCPAuthSeedDeps } from './types.ts';

export interface EnrolledPasskeyDeps extends MCPAuthSeedDeps {
  // The server the enrollment runs through, at its test address and its public origin.
  readonly server: { readonly url: string; readonly origin: string };
}

export interface EnrolledPasskeyInput {
  readonly authenticator: Pick<ReturnType<typeof buildStubAuthenticator>, 'create'>;
}

// A passkey the stub authenticator holds the key of, so a test can sign in with it. The server's
// enrollment page writes it, from a fresh enrollment token.
export async function seedEnrolledPasskey(
  deps: EnrolledPasskeyDeps,
  input: EnrolledPasskeyInput,
): Promise<void> {
  const enrollment = await createEnrollmentToken(deps.db, deps.clock.now());

  await runPasskeyEnrollment(deps.server, enrollment.token, input.authenticator);
}
