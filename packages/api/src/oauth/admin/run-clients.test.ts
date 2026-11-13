import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import type { OAuthClientID } from '../auth/types.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { runClients } from './run-clients.ts';

function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-clients-');

  return { dbPath: join(temporaryDirectory.path, 'state', 'mcp-auth.db') };
}

test('it adds a client and prints its client ID', async () => {
  const ctx = setupTest();
  const printed: string[] = [];
  const errors: string[] = [];
  const codes: number[] = [];
  const exits: number[] = [];

  await runClients(
    { kind: 'add', name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
    { dbPath: ctx.dbPath, command: 'clients' },
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
  );

  expect({ errors, codes, exits }).toStrictEqual({ errors: [], codes: [], exits: [] });
  expect(printed.join('\n')).toMatch(/^Added Claude\. Its client ID is \w+$/u);
});

test('it lists an added client with every redirect URI it was given', async () => {
  const ctx = setupTest();
  const added: string[] = [];

  await runClients(
    {
      kind: 'add',
      name: 'Claude',
      redirectURIs: [
        'https://assistant.example.com/callback',
        'https://claude.com/api/mcp/auth_callback',
      ],
    },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: (line) => {
        added.push(line);
      },
      printError: () => {},
      setExitCode: () => {},
      exit: () => {},
    },
  );

  const clientID = /client ID is (?<id>\w+)/u.exec(added.join('\n'))?.groups?.['id'];

  invariant(clientID !== undefined, `no client ID in: ${added.join('\n')}`);

  const printed: string[] = [];

  await runClients(
    { kind: 'list' },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: (line) => {
        printed.push(line);
      },
      printError: () => {},
      setExitCode: () => {},
      exit: () => {},
    },
  );

  expect(printed).toStrictEqual([
    `${clientID}  Claude  https://assistant.example.com/callback https://claude.com/api/mcp/auth_callback`,
  ]);
});

test('it removes a client and says it revoked every grant the client held', async () => {
  const ctx = setupTest();
  const added: string[] = [];

  await runClients(
    { kind: 'add', name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: (line) => {
        added.push(line);
      },
      printError: () => {},
      setExitCode: () => {},
      exit: () => {},
    },
  );

  const clientID = /client ID is (?<id>\w+)/u.exec(added.join('\n'))?.groups?.['id'];

  invariant(clientID !== undefined, `no client ID in: ${added.join('\n')}`);

  const printed: string[] = [];

  await runClients(
    { kind: 'remove', clientID: toTagged<OAuthClientID>(clientID) },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: (line) => {
        printed.push(line);
      },
      printError: () => {},
      setExitCode: () => {},
      exit: () => {},
    },
  );

  expect(printed).toStrictEqual([`Removed client ${clientID} and revoked every grant it held`]);
});

test('it lists no clients and how to add one once the last client is removed', async () => {
  const ctx = setupTest();
  const added: string[] = [];

  await runClients(
    { kind: 'add', name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: (line) => {
        added.push(line);
      },
      printError: () => {},
      setExitCode: () => {},
      exit: () => {},
    },
  );

  const clientID = /client ID is (?<id>\w+)/u.exec(added.join('\n'))?.groups?.['id'];

  invariant(clientID !== undefined, `no client ID in: ${added.join('\n')}`);

  await runClients(
    { kind: 'remove', clientID: toTagged<OAuthClientID>(clientID) },
    { dbPath: ctx.dbPath, command: 'clients' },
    { print: () => {}, printError: () => {}, setExitCode: () => {}, exit: () => {} },
  );

  const printed: string[] = [];

  await runClients(
    { kind: 'list' },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: (line) => {
        printed.push(line);
      },
      printError: () => {},
      setExitCode: () => {},
      exit: () => {},
    },
  );

  expect(printed).toStrictEqual([
    'No clients. Add one with: clients add <name> --redirect-uri <uri>',
  ]);
});

test('it exits 1 when an add gives no redirect URI', async () => {
  const ctx = setupTest();
  const errors: string[] = [];
  const codes: number[] = [];
  const exits: number[] = [];

  await runClients(
    { kind: 'add', name: 'Claude', redirectURIs: [] },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: () => {},
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
  );

  expect({ exits, codes, errors }).toStrictEqual({
    exits: [1],
    codes: [],
    errors: ['clients add: give at least one --redirect-uri'],
  });
});

test('it exits 1 for a redirect URI that is not https or loopback http', async () => {
  const ctx = setupTest();
  const errors: string[] = [];
  const codes: number[] = [];
  const exits: number[] = [];

  await runClients(
    { kind: 'add', name: 'dots', redirectURIs: ['http://dots.example/cb'] },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: () => {},
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
  );

  expect({ exits, codes, errors }).toStrictEqual({
    exits: [1],
    codes: [],
    errors: [
      "clients add: 'http://dots.example/cb' is not a redirect URI pepys accepts; use https, or http on a loopback host, with no fragment",
    ],
  });
});

test('it refuses to remove an unknown client', async () => {
  const ctx = setupTest();
  const errors: string[] = [];
  const codes: number[] = [];
  const exits: number[] = [];

  await runClients(
    { kind: 'remove', clientID: toTagged<OAuthClientID>('unknown') },
    { dbPath: ctx.dbPath, command: 'clients' },
    {
      print: () => {},
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
  );

  expect({ exits, codes, errors }).toStrictEqual({
    exits: [],
    codes: [1],
    errors: ["clients remove: no client has the ID 'unknown'"],
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
    { kind: 'remove', clientID: toTagged<OAuthClientID>('unknown') },
    { dbPath: ctx.dbPath, command: 'clients' },
  );

  expect(process.exitCode).toBe(1);
});
