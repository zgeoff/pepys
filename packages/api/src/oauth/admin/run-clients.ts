import { MCPAuthError } from '@zgeoff/mcp-auth';
import type { ClientView, MCPAuthAdmin, OAuthClientID } from '@zgeoff/mcp-auth';
import { match } from 'ts-pattern';
import { openAuthAdmin } from './open-auth-admin.ts';
import { PROCESS_IO } from './process-io.ts';
import type { ProcessIO } from './process-io.ts';

// The client a remove names: by its name, or by its client ID.
type ClientReference =
  | { readonly by: 'name'; readonly name: string }
  | { readonly by: 'id'; readonly clientID: OAuthClientID };

export type ClientsAction =
  | { readonly kind: 'list' }
  | { readonly kind: 'add'; readonly name: string; readonly redirectURIs: readonly string[] }
  | { readonly kind: 'remove'; readonly client: ClientReference };

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
      const choice = await resolveClientToRemove(opened.admin, action.client);

      if (choice.kind !== 'remove') {
        io.printError(`${target.command} remove: ${formatRefusedRemove(choice, target.command)}`);
        io.setExitCode(1);

        return;
      }

      const revoked = await opened.admin.clients.remove(choice.clientID);

      const named = action.client.by === 'id' ? action.client.clientID : action.client.name;

      io.print(`Removed client ${named} and revoked the ${revoked} grants it held`);

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

type RemoveChoice =
  | { readonly kind: 'remove'; readonly clientID: OAuthClientID }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly clientIDs: readonly OAuthClientID[] };

async function resolveClientToRemove(
  admin: MCPAuthAdmin,
  client: ClientReference,
): Promise<RemoveChoice> {
  if (client.by === 'id') {
    return { kind: 'remove', clientID: client.clientID };
  }

  const matches = await admin.clients.readByName(client.name);

  return pickClientToRemove(matches);
}

// A database from before the core cleaned names can hold two names that clean
// alike, so a name picks a client only when it matches exactly one.
function pickClientToRemove(matches: readonly ClientView[]): RemoveChoice {
  const [only, ...others] = matches;

  if (only === undefined) {
    return { kind: 'missing' };
  }

  if (others.length > 0) {
    return { kind: 'ambiguous', clientIDs: matches.map((client) => client.clientID).toSorted() };
  }

  return { kind: 'remove', clientID: only.clientID };
}

function formatRefusedRemove(
  choice: Exclude<RemoveChoice, { kind: 'remove' }>,
  command: string,
): string {
  return match(choice)
    .with({ kind: 'missing' }, () => 'no client has that name')
    .with(
      { kind: 'ambiguous' },
      (ambiguous) =>
        `${ambiguous.clientIDs.length} clients have that name: ${ambiguous.clientIDs.join(', ')}. Remove one by its ID with: ${command} remove --id <client_id>`,
    )
    .exhaustive();
}
