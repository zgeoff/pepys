import type { GrantID } from '@zgeoff/mcp-auth';
import { openAuthAdmin } from './open-auth-admin.ts';
import { PROCESS_IO } from './process-io.ts';
import type { ProcessIO } from './process-io.ts';

// The authorization server's database, and the command that prefixes every
// message, such as `grants`.
interface GrantsTarget {
  readonly dbPath: string;
  readonly command: string;
}

export async function runGrants(
  revoke: GrantID | null,
  target: GrantsTarget,
  io: Pick<ProcessIO, 'print' | 'printError' | 'setExitCode'> = PROCESS_IO,
): Promise<void> {
  const opened = await openAuthAdmin(target.dbPath);

  try {
    if (revoke !== null) {
      const revoked = await opened.admin.grants.revoke(revoke);

      if (!revoked) {
        io.printError(`${target.command}: no grant has the ID '${revoke}'`);
        io.setExitCode(1);

        return;
      }

      io.print(`Revoked grant ${revoke}`);

      return;
    }

    const grants = await opened.admin.grants.list();

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
    await opened.close();
  }
}
