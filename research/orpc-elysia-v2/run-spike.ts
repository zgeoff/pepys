import {
  Client as ClientV2,
  StreamableHTTPClientTransport as TransportV2,
} from '@modelcontextprotocol/client';
import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as TransportV1 } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer as McpServerV2 } from '@modelcontextprotocol/server';
import { createORPCClient as createV2Client } from '@orpc/client';
import { RPCLink as RPCLinkV2 } from '@orpc/client/fetch';
import { McpRegistrar } from '@orpc/mcp';
import type { RouterClient as RouterClientV2 } from '@orpc/server';
import type { Elysia } from 'elysia';
import { createORPCClient as createV1Client } from 'orpc-v1-client';
import { RPCLink as RPCLinkV1 } from 'orpc-v1-client/fetch';
import type { RouterClient as RouterClientV1 } from 'orpc-v1-server';
import { createV1App, createV1Router } from './create-v1-app.ts';
import type { V1Router } from './create-v1-app.ts';
import { createV2App } from './create-v2-app.ts';
import type { V2Router } from './create-v2-app.ts';
import type { Note } from './notes.ts';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface NoteInput {
  id: string;
}

interface NoteClient {
  get_note: (input: NoteInput) => Promise<Note>;
}

const expectedNote: Note = { id: 'demo:note:1', title: 'Moor at the quay', words: 4 };
const checks: Check[] = [];

await runLeg('oRPC 1.16.1', createV1App(), ['/mcp-v2', '/mcp'], (base) => {
  const client: RouterClientV1<V1Router> = createV1Client(new RPCLinkV1({ url: `${base}/rpc` }));

  return client;
});

await runLeg('oRPC 2.0.0-beta.47', createV2App(), ['/mcp'], (base) => {
  const client: RouterClientV2<V2Router> = createV2Client(
    new RPCLinkV2({ origin: base, url: '/rpc' }),
  );

  return client;
});

await runRegistrarOnV1Router();

for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  ${check.detail}`);
}

const failed = checks.filter((check) => !check.ok).length;
const exitCode = failed === 0 ? 0 : 1;

console.log(`\n${checks.length - failed} of ${checks.length} checks pass`);
process.exit(exitCode);

async function runLeg(
  leg: string,
  app: Pick<Elysia, 'listen' | 'server' | 'stop'>,
  mcpPaths: readonly string[],
  buildClient: (base: string) => NoteClient,
) {
  app.listen({ port: 0, hostname: '127.0.0.1' });

  const base = `http://127.0.0.1:${app.server?.port}`;

  try {
    await runRPCChecks(leg, buildClient(base));
    await runRPCMissCheck(leg, base);

    for (const path of mcpPaths) {
      const url = `${base}${path}`;

      await runMCPChecks(`${leg} ${path}, client 2.4.0 auto`, () => openV2Session(url, 'auto'));
      await runMCPChecks(`${leg} ${path}, client 2.4.0 legacy`, () => openV2Session(url, 'legacy'));
      await runMCPChecks(`${leg} ${path}, client 1.32.2`, () => openV1Session(url));
    }
  } finally {
    await app.stop();
  }
}

async function runRPCChecks(leg: string, client: NoteClient) {
  const note = await client.get_note({ id: 'demo:note:1' });

  // The type check proves the typed result, and that a wrong input fails to compile.
  note satisfies Note;

  // @ts-expect-error a number is not a note ID
  void (() => client.get_note({ id: 1 }));
  record(`${leg} RPC typed call`, Bun.deepEquals(note, expectedNote), JSON.stringify(note));

  record(
    `${leg} RPC bad input`,
    ...(await readErrorCode(() => client.get_note({ id: 'nope' }), 'BAD_REQUEST')),
  );

  record(
    `${leg} RPC unknown note`,
    ...(await readErrorCode(() => client.get_note({ id: 'demo:note:9' }), 'NOT_FOUND')),
  );
}

async function runRPCMissCheck(leg: string, base: string) {
  const response = await fetch(`${base}/rpc/no_such_query`, { method: 'POST', body: '{}' });

  record(`${leg} RPC unknown route`, response.status === 404, `status ${response.status}`);
}

async function readErrorCode(
  run: () => Promise<unknown>,
  expected: string,
): Promise<[boolean, string]> {
  try {
    await run();

    return [false, 'resolved'];
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : String(error);

    return [code === expected, code];
  }
}

interface ListedTool {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
  outputSchema?: unknown;
}

interface ToolResult {
  isError: boolean;
  structuredContent: unknown;
}

interface MCPSession {
  protocolVersion: string;
  listTools: () => Promise<ListedTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  close: () => Promise<void>;
}

async function openV2Session(url: string, mode: 'auto' | 'legacy'): Promise<MCPSession> {
  const client = new ClientV2(
    { name: 'spike-client-v2', version: '0.0.0' },
    { versionNegotiation: { mode } },
  );

  await client.connect(new TransportV2(new URL(url)));

  return {
    protocolVersion: client.getNegotiatedProtocolVersion() ?? 'unknown',
    listTools: async () => {
      const result = await client.listTools();

      return result.tools;
    },
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });

      return { isError: result.isError === true, structuredContent: result.structuredContent };
    },
    close: () => client.close(),
  };
}

async function openV1Session(url: string): Promise<MCPSession> {
  const client = new ClientV1({ name: 'spike-client-v1', version: '0.0.0' });
  const transport = new TransportV1(new URL(url));

  await client.connect(transport);

  return {
    protocolVersion: transport.protocolVersion ?? 'unknown',
    listTools: async () => {
      const result = await client.listTools();

      return result.tools;
    },
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });

      return { isError: result.isError === true, structuredContent: result.structuredContent };
    },
    close: () => client.close(),
  };
}

async function runMCPChecks(leg: string, openSession: () => Promise<MCPSession>) {
  let session: MCPSession;

  try {
    session = await openSession();
  } catch (error) {
    record(`${leg} connect`, false, String(error));

    return;
  }

  try {
    record(`${leg} connect`, true, `protocol ${session.protocolVersion}`);

    const tools = await session.listTools();

    const tool = tools.find((candidate) => candidate.name === 'get_note');

    record(
      `${leg} list tools`,
      tool?.description !== undefined && tool.outputSchema !== undefined,
      JSON.stringify(tool),
    );

    const hit = await session.callTool('get_note', { id: 'demo:note:1' });

    record(
      `${leg} call tool`,
      !hit.isError && Bun.deepEquals(hit.structuredContent, expectedNote),
      JSON.stringify(hit.structuredContent),
    );

    const miss = await session.callTool('get_note', { id: 'demo:note:9' });

    record(`${leg} call tool, unknown note`, miss.isError, `isError ${String(miss.isError)}`);
  } catch (error) {
    record(`${leg} session`, false, String(error));
  } finally {
    await session.close();
  }
}

async function runRegistrarOnV1Router() {
  const server = new McpServerV2({ name: 'spike-registrar-v1', version: '0.0.0' });

  try {
    // @ts-expect-error McpRegistrar takes a router built by oRPC v2
    const registrar = new McpRegistrar(createV1Router());

    await registrar.register(server, { context: { requestedBy: 'mcp' } });

    console.log('NOTE  @orpc/mcp registered a v1 router');
  } catch (error) {
    console.log(`NOTE  @orpc/mcp refuses a v1 router: ${String(error)}`);
  }
}

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}
