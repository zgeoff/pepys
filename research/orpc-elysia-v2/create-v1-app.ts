import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { McpServer as McpServerV2, createMcpHandler } from '@modelcontextprotocol/server';
import { Elysia } from 'elysia';
import { ORPCError, call, os } from 'orpc-v1-server';
import { RPCHandler } from 'orpc-v1-server/fetch';
import { getNoteDescription, noteInputSchema, noteSchema, notes } from './notes.ts';
import type { NoteInput } from './notes.ts';

export function createV1Router() {
  return {
    get_note: os
      .$context<{ requestedBy: string }>()
      .route({ summary: 'get_note', description: getNoteDescription })
      .input(noteInputSchema)
      .output(noteSchema)
      .handler((options) => {
        const note = notes.get(options.input.id);

        if (note === undefined) {
          throw new ORPCError('NOT_FOUND', { message: `no note ${options.input.id}` });
        }

        return note;
      }),
  };
}

export type V1Router = ReturnType<typeof createV1Router>;

export function createV1App() {
  const router = createV1Router();

  const rpcHandler = new RPCHandler(router);

  // oRPC v1 has no MCP integration, so each tool calls the procedure by hand.
  const runTool = async (args: NoteInput) => {
    try {
      const note = await call(router.get_note, args, { context: { requestedBy: 'mcp' } });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(note) }],
        structuredContent: note,
      };
    } catch (error) {
      const message = error instanceof ORPCError ? `${error.code}: ${error.message}` : 'failed';

      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  };

  const modernHandler = createMcpHandler(() => {
    const server = new McpServerV2({ name: 'spike-v1-sdk-v2', version: '0.0.0' });

    server.registerTool(
      'get_note',
      {
        description: getNoteDescription,
        inputSchema: noteInputSchema,
        outputSchema: noteSchema,
        annotations: { readOnlyHint: true },
      },
      runTool,
    );

    return server;
  });

  return new Elysia()
    .all('/rpc/*', { parse: 'none' }, async (route) => {
      const result = await rpcHandler.handle(route.request, {
        prefix: '/rpc',
        context: { requestedBy: 'rpc' },
      });

      return result.matched ? result.response : new Response('not found', { status: 404 });
    })
    .all('/mcp-v2', { parse: 'none' }, (route) => modernHandler.fetch(route.request))
    .all('/mcp', { parse: 'none' }, async (route) => {
      const server = new McpServer({ name: 'spike-v1', version: '0.0.0' });

      server.registerTool(
        'get_note',
        {
          description: getNoteDescription,
          inputSchema: noteInputSchema.shape,
          outputSchema: noteSchema.shape,
          annotations: { readOnlyHint: true },
        },
        runTool,
      );

      // With no sessionIdGenerator the transport serves each request statelessly.
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

      await server.connect(transport);

      return transport.handleRequest(route.request);
    });
}
