import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import type { OAuthClientID } from '@zgeoff/mcp-auth';
import { toTagged } from '@zgeoff/std';
import { authorizeMCPClient } from '../../test-utils/authorize-mcp-client.ts';
import { seedLegacyClient } from '../test-utils/seed-legacy-client.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { runClients } from './run-clients.ts';
import type { ClientsAction } from './run-clients.ts';

// A database file in a folder the command creates, and every line, exit code
// and exit the command gives.
function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-clients-');
  const dbPath = join(temporaryDirectory.path, 'state', 'mcp-auth.db');
  const printed: string[] = [];
  const errors: string[] = [];
  const codes: number[] = [];
  const exits: number[] = [];

  return {
    dbPath,
    printed,
    errors,
    codes,
    exits,
    seed: { legacyClient: (name: string) => seedLegacyClient(dbPath, name) },
    runClients: (action: ClientsAction) =>
      runClients(
        action,
        { dbPath, command: 'clients' },
        {
          print: (line) => {
            printed.push(line);
          },
          printError: (line) => {
            errors.push(line);
          },
          setExitCode: (code) => {
            codes.push(code);
          },
          exit: (code) => {
            exits.push(code);
          },
        },
      ),
  };
}

test('it adds a client and prints its client ID', async () => {
  const ctx = setupTest();

  await ctx.runClients({
    kind: 'add',
    name: 'Claude',
    redirectURIs: ['https://assistant.example.com/callback'],
  });

  expect({ printed: ctx.printed, errors: ctx.errors, codes: ctx.codes }).toStrictEqual({
    printed: [expect.stringMatching(/^Added Claude\. Its client ID is \w+$/u)],
    errors: [],
    codes: [],
  });
});

test('it lists an added client with every redirect URI it was given', async () => {
  const ctx = setupTest();

  await ctx.runClients({
    kind: 'add',
    name: 'Claude',
    redirectURIs: [
      'https://assistant.example.com/callback',
      'https://claude.com/api/mcp/auth_callback',
    ],
  });

  await ctx.runClients({ kind: 'list' });

  const clientID = /client ID is (?<id>\w+)/u.exec(ctx.printed[0] ?? '')?.groups?.['id'];

  expect(ctx.printed[1]).toBe(
    `${clientID}  Claude  https://assistant.example.com/callback https://claude.com/api/mcp/auth_callback`,
  );
});

test('it removes a client by name and says how many grants it revoked', async () => {
  const ctx = setupTest();

  await ctx.runClients({
    kind: 'add',
    name: 'Claude',
    redirectURIs: ['https://assistant.example.com/callback'],
  });

  await ctx.runClients({ kind: 'remove', client: { by: 'name', name: 'Claude' } });
  await ctx.runClients({ kind: 'list' });

  expect(ctx.printed.slice(1)).toStrictEqual([
    'Removed client Claude and revoked the 0 grants it held',
    'No clients. Add one with: clients add <name> --redirect-uri <uri>',
  ]);
});

test('it revokes the grant of a client it removes', async () => {
  const ctx = setupTest();

  await ctx.runClients({ kind: 'list' });

  const grant = await authorizeMCPClient({ origin: 'http://127.0.0.1:8081', dbPath: ctx.dbPath }, [
    'read',
  ]);

  await ctx.runClients({ kind: 'list' });

  const name = ctx.printed[1]?.split('  ')[1] ?? '';

  await ctx.runClients({ kind: 'remove', client: { by: 'name', name } });

  expect(ctx.printed[2]).toBe(`Removed client ${name} and revoked the 1 grants it held`);
  expect(grant.grantID).toBeString();
});

test('it exits 1 when an add gives no redirect URI', async () => {
  const ctx = setupTest();

  await ctx.runClients({ kind: 'add', name: 'Claude', redirectURIs: [] });

  expect({ exits: ctx.exits, codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    exits: [1],
    codes: [],
    errors: ['clients add: give at least one --redirect-uri'],
  });
});

test('it sets exit code 1 for a redirect URI that is not https or loopback http', async () => {
  const ctx = setupTest();

  await ctx.runClients({ kind: 'add', name: 'dots', redirectURIs: ['http://dots.example/cb'] });

  expect({ exits: ctx.exits, codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    exits: [],
    codes: [1],
    errors: [
      'clients add: a redirect URI must use https, or http on a loopback host, with no fragment or user info',
    ],
  });
});

test('it sets exit code 1 for a name another client holds', async () => {
  const ctx = setupTest();

  await ctx.runClients({ kind: 'add', name: 'Claude', redirectURIs: ['https://a.example/cb'] });
  await ctx.runClients({ kind: 'add', name: 'Claude', redirectURIs: ['https://b.example/cb'] });

  expect({ codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    codes: [1],
    errors: ['clients add: a client already has that name'],
  });
});

test('it refuses to remove an unknown client', async () => {
  const ctx = setupTest();

  await ctx.runClients({ kind: 'remove', client: { by: 'name', name: 'unknown' } });

  expect({ exits: ctx.exits, codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    exits: [],
    codes: [1],
    errors: ['clients remove: no client has that name'],
  });
});

test('it sets the process exit code to 1 when it refuses a remove by default', async () => {
  const ctx = setupTest();

  // Bun ignores an assignment of undefined, so an unset exit code goes back
  // as 0, the code an unset one exits with.
  const exitCode = process.exitCode ?? 0;

  onTestFinished(() => {
    process.exitCode = exitCode;
  });

  await runClients(
    { kind: 'remove', client: { by: 'name', name: 'unknown' } },
    { dbPath: ctx.dbPath, command: 'clients' },
  );

  expect(process.exitCode).toBe(1);
});

test('it refuses a name that two clients clean to, and lists both IDs', async () => {
  const ctx = setupTest();

  const spacedID = await ctx.seed.legacyClient('  Spaced\tOrchard  ');
  const plainID = await ctx.seed.legacyClient('Spaced Orchard');

  await ctx.runClients({ kind: 'remove', client: { by: 'name', name: 'Spaced Orchard' } });

  expect({ printed: ctx.printed, codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    printed: [],
    codes: [1],
    errors: [
      `clients remove: 2 clients have that name: ${[spacedID, plainID].toSorted().join(', ')}. Remove one by its ID with: clients remove --id <client_id>`,
    ],
  });
});

test('it keeps both clients when it refuses a name that two clients clean to', async () => {
  const ctx = setupTest();

  const spacedID = await ctx.seed.legacyClient('  Spaced\tOrchard  ');
  const plainID = await ctx.seed.legacyClient('Spaced Orchard');

  await ctx.runClients({ kind: 'remove', client: { by: 'name', name: 'Spaced Orchard' } });
  await ctx.runClients({ kind: 'list' });

  expect(ctx.printed).toStrictEqual([
    expect.stringMatching(new RegExp(`^${spacedID}  `, 'u')),
    expect.stringMatching(new RegExp(`^${plainID}  `, 'u')),
  ]);
});

test('it removes only the client with the given ID when two names clean alike', async () => {
  const ctx = setupTest();

  const spacedID = await ctx.seed.legacyClient('  Spaced\tOrchard  ');
  const plainID = await ctx.seed.legacyClient('Spaced Orchard');

  await ctx.runClients({ kind: 'remove', client: { by: 'id', clientID: spacedID } });
  await ctx.runClients({ kind: 'list' });

  expect(ctx.printed).toStrictEqual([
    `Removed client ${spacedID} and revoked the 0 grants it held`,
    `${plainID}  Spaced Orchard  https://assistant.example.com/callback`,
  ]);
});

test('it refuses to remove an unknown client ID', async () => {
  const ctx = setupTest();

  await ctx.runClients({
    kind: 'remove',
    client: { by: 'id', clientID: toTagged<OAuthClientID>('unknown') },
  });

  expect({ codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    codes: [1],
    errors: ['clients remove: no client has that ID'],
  });
});
