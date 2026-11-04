import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { McpRegistrar, mcp } from '@orpc/mcp';
import { ORPCError, os } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Elysia } from 'elysia';
import { getNoteDescription, noteInputSchema, noteSchema, notes } from './notes.ts';

export function createV2Router() {
  return {
    get_note: os
      .$context<{ requestedBy: string }>()
      .meta(mcp.tool({ description: getNoteDescription, annotations: { readOnlyHint: true } }))
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

export type V2Router = ReturnType<typeof createV2Router>;

export function createV2App() {
  const router = createV2Router();

  const rpcHandler = new RPCHandler(router);
  const registrar = new McpRegistrar(router);

  const mcpHandler = createMcpHandler(async () => {
    const server = new McpServer({ name: 'spike-v2', version: '0.0.0' });

    await registrar.register(server, { context: { requestedBy: 'mcp' } });

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
    .all('/mcp', { parse: 'none' }, (route) => mcpHandler.fetch(route.request));
}
