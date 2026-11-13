import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { readGrantViews } from '../auth/read-grant-views.ts';
import { revokeGrant } from '../auth/revoke-grant.ts';
import type { OAuthGrantID } from '../auth/types.ts';
import { openMCPAuthDatabase } from './open-mcp-auth-database.ts';
import { PROCESS_IO } from './process-io.ts';
import type { ProcessIO } from './process-io.ts';

// The authorization server's database, and the command that prefixes every
// message, such as `grants`.
interface GrantsTarget {
  readonly dbPath: string;
  readonly command: string;
}

export async function runGrants(
  revoke: OAuthGrantID | null,
  target: GrantsTarget,
  io: Pick<ProcessIO, 'print' | 'printError' | 'setExitCode'> = PROCESS_IO,
): Promise<void> {
  mkdirSync(dirname(target.dbPath), { recursive: true });

  const store = await openMCPAuth({
    dbPath: target.dbPath,
    openDatabase: openMCPAuthDatabase,
    origin: null,
  });

  try {
    if (revoke !== null) {
      const revoked = await revokeGrant(store.db, revoke);

      if (!revoked) {
        io.printError(`${target.command}: no grant has the ID '${revoke}'`);
        io.setExitCode(1);

        return;
      }

      io.print(`Revoked grant ${revoke}`);

      return;
    }

    const grants = await readGrantViews(store.db);

    if (grants.length === 0) {
      io.print('No grants.');

      return;
    }

    for (const grant of grants) {
      io.print(
        `${grant.grantID}  ${grant.clientName}  ${grant.scopes.join(',')}  last used ${grant.lastUsedAt ?? 'never'}`,
      );
    }
  } finally {
    await store.close();
  }
}
