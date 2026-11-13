import { authorizeTestClient } from '@zgeoff/mcp-auth/testing';
import { openSharedAuth } from './open-shared-auth.ts';

type TestClientAuthorization = Awaited<ReturnType<typeof authorizeTestClient>>;

interface AuthorizedServer {
  // The public origin of the server, and its database file.
  readonly origin: string;
  readonly dbPath: string;
}

// A new client's grant on a server's database, through a whole sign-in with a
// stub passkey. The tokens live in the shared file, so the server accepts them.
export async function authorizeMCPClient(
  server: AuthorizedServer,
  scopes: readonly string[],
): Promise<TestClientAuthorization> {
  const auth = await openSharedAuth(server);

  return authorizeTestClient(auth, { scopes });
}
