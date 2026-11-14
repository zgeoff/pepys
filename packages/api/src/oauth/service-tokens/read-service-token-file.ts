import { readFile } from 'node:fs/promises';
import { parseServiceTokenFile } from '@zgeoff/mcp-auth';
import type { ParsedServiceTokenFile } from '@zgeoff/mcp-auth';
import { GRANT_SCOPES, SERVICE_TOKEN_PREFIX } from '../constants.ts';
import type { GrantScope } from '../constants.ts';

// The service clients in the file at `path`. A file that is missing or fails to parse gives the
// reason, which never quotes the file, since a value in it may be a token.
export async function readServiceTokenFile(
  path: string,
): Promise<ParsedServiceTokenFile<GrantScope>> {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';

    return { ok: false, reason: `the file cannot be read (${code})` };
  }

  return parseServiceTokenFile(text, { prefix: SERVICE_TOKEN_PREFIX, scopes: GRANT_SCOPES });
}
