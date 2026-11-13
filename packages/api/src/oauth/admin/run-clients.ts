import { MCPAuthError } from '@zgeoff/mcp-auth';
import { openAuthAdmin } from './open-auth-admin.ts';
import { PROCESS_IO } from './process-io.ts';
import type { ProcessIO } from './process-io.ts';

export type ClientsAction =
  | { readonly kind: 'list' }
  | { readonly kind: 'add'; readonly name: string; readonly redirectURIs: readonly string[] }
  | { readonly kind: 'remove'; readonly name: string };

// The authorization server's database, and the command that prefixes every
// message, such as `clients`.
interface ClientsTarget {
  readonly dbPath: string;
  readonly command: string;
}

export async function runClients(
  action: ClientsAction,
  target: ClientsTarget,
  io: Pick<ProcessIO, 'print' | 'printError' | 'setExitCode' | 'exit'> = PROCESS_IO,
): Promise<void> {
  if (action.kind === 'add' && action.redirectURIs.length === 0) {
    io.printError(`${target.command} add: give at least one --redirect-uri`);
    io.exit(1);

    return;
  }

  const opened = await openAuthAdmin(target.dbPath);

  try {
    if (action.kind === 'add') {
      const added = await opened.admin.clients.add(action.name, action.redirectURIs);

      io.print(`Added ${added.name}. Its client ID is ${added.clientID}`);

      return;
    }

    if (action.kind === 'remove') {
      const revoked = await opened.admin.clients.remove(action.name);

      io.print(`Removed client ${action.name} and revoked the ${revoked} grants it held`);

      return;
    }

    const clients = await opened.admin.clients.list();

    if (clients.length === 0) {
      io.print(`No clients. Add one with: ${target.command} add <name> --redirect-uri <uri>`);

      return;
    }

    for (const client of clients) {
      io.print(`${client.clientID}  ${client.name}  ${client.redirectURIs.join(' ')}`);
    }
  } catch (error) {
    // The core refuses a taken or unknown name and a redirect URI it does not
    // accept with an error the owner can act on.
    if (!(error instanceof MCPAuthError)) {
      throw error;
    }

    io.printError(`${target.command} ${action.kind}: ${error.message}`);
    io.setExitCode(1);
  } finally {
    await opened.close();
  }
}
