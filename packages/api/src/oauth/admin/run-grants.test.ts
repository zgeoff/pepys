import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import type { GrantID } from '@zgeoff/mcp-auth';
import { toTagged } from '@zgeoff/std';
import { authorizeMCPClient } from '../../test-utils/authorize-mcp-client.ts';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { runGrants } from './run-grants.ts';

// A running server on the database the command opens, and the lines the
// command prints.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-grants-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({ dbPath });

  const printed: string[] = [];
  const errors: string[] = [];
  const codes: number[] = [];

  return {
    server,
    printed,
    errors,
    codes,
    authorize: () => authorizeMCPClient({ origin: server.origin, dbPath }, ['read']),
    runGrants: (revoke: GrantID | null) =>
      runGrants(
        revoke,
        { dbPath, command: 'grants' },
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
        },
      ),
    dbPath,
  };
}

test('it lists a grant with its client, its scopes and when it was last used', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize();

  await ctx.runGrants(null);

  expect(ctx.printed).toStrictEqual([
    expect.stringMatching(
      new RegExp(`^${grant.grantID}  client-\\S+  read  last used never$`, 'u'),
    ),
  ]);
});

test('it revokes a grant so its access token stops working and it lists no grants', async () => {
  const ctx = await setupTest();
  const grant = await ctx.authorize();

  await ctx.runGrants(grant.grantID);

  const pinged = await fetch(`${ctx.server.url}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${grant.accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

  await ctx.runGrants(null);

  expect({ printed: ctx.printed, errors: ctx.errors, codes: ctx.codes }).toStrictEqual({
    printed: [`Revoked grant ${grant.grantID}`, 'No grants.'],
    errors: [],
    codes: [],
  });

  expect(pinged.status).toBe(401);
});

test('it refuses to revoke an unknown grant', async () => {
  const ctx = await setupTest();

  await ctx.runGrants(toTagged<GrantID>('unknown'));

  expect({ codes: ctx.codes, errors: ctx.errors }).toStrictEqual({
    codes: [1],
    errors: ["grants: no grant has the ID 'unknown'"],
  });
});

test('it sets the process exit code to 1 when it refuses to revoke by default', async () => {
  const ctx = await setupTest();

  // Bun ignores an assignment of undefined, so an unset exit code goes back
  // as 0, the code an unset one exits with.
  const exitCode = process.exitCode ?? 0;

  onTestFinished(() => {
    process.exitCode = exitCode;
  });

  await runGrants(toTagged<GrantID>('unknown'), { dbPath: ctx.dbPath, command: 'grants' });

  expect(process.exitCode).toBe(1);
});
