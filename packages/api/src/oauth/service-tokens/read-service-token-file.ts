import { readFile } from 'node:fs/promises';
import { parseServiceTokenFile } from '@zgeoff/mcp-auth';
import type { ParsedServiceTokenFile } from '@zgeoff/mcp-auth';
import { z } from 'zod';
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

  return parsePepysServiceTokenFile(text);
}

// The package's parser, plus two departures the oauth-server doc explains: a file of no clients
// parses, so removing the last client revokes it, and a client with a static token is refused.
function parsePepysServiceTokenFile(text: string): ParsedServiceTokenFile<GrantScope> {
  const parsed = parseServiceTokenFile(text, {
    prefix: SERVICE_TOKEN_PREFIX,
    scopes: GRANT_SCOPES,
  });

  if (!parsed.ok) {
    return findEmptyServiceTokenFile(text) ?? parsed;
  }

  const holder = parsed.file.clients.find((client) => client.tokens.length > 0);

  return holder === undefined
    ? parsed
    : {
        ok: false,
        reason: `the client ${holder.name} holds a static token, and pepys takes only secretDigests`,
      };
}

const EmptyFileSchema = z.strictObject({
  resource: z.string().min(1),
  clients: z.strictObject({}),
});

function findEmptyServiceTokenFile(text: string): ParsedServiceTokenFile<GrantScope> | null {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  const empty = EmptyFileSchema.safeParse(raw);

  return empty.success ? { ok: true, file: { resource: empty.data.resource, clients: [] } } : null;
}
