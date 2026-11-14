import { MCPAuthError } from '@zgeoff/mcp-auth';
import type { MCPAuth } from '@zgeoff/mcp-auth';
import type { GrantScope } from '../constants.ts';
import { readServiceTokenFile } from './read-service-token-file.ts';

export type ServiceTokenReload =
  | { readonly kind: 'replaced'; readonly clients: number }
  | { readonly kind: 'kept'; readonly reason: string };

// Reads the service-token file again and hands it to the auth core. A file that fails to read or
// parse, or that names another resource, leaves the clients the core holds as they were.
export async function reloadServiceTokens(
  auth: Pick<MCPAuth<GrantScope>, 'replaceServiceTokens'>,
  path: string,
): Promise<ServiceTokenReload> {
  const parsed = await readServiceTokenFile(path);

  if (!parsed.ok) {
    return { kind: 'kept', reason: parsed.reason };
  }

  try {
    auth.replaceServiceTokens(parsed.file);
  } catch (error) {
    if (error instanceof MCPAuthError) {
      return { kind: 'kept', reason: error.message };
    }

    throw error;
  }

  return { kind: 'replaced', clients: parsed.file.clients.length };
}
