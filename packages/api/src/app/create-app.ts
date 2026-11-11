import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { McpRegistrar } from '@orpc/mcp';
import { COMMON_ERROR_STATUS_MAP } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Elysia } from 'elysia';
import type { QueryContext } from '../queries/types.ts';
import { createRouter } from './create-router.ts';

// The router at /rpc, and each of its procedures as an MCP tool at /mcp.
export function createApp(context: QueryContext) {
  const router = createRouter(context.deployment.queries);

  // A contract's own status has no effect in oRPC v2: the handler's map gives each code its HTTP
  // status, and a code the map lacks gets 400. The map sets 503 itself, so it rests on no default.
  const rpc = new RPCHandler(router, {
    errorStatusMap: { ...COMMON_ERROR_STATUS_MAP, SERVICE_UNAVAILABLE: 503 },
  });

  const registrar = new McpRegistrar(router);

  // stateless: one server per request, with the tools of the one router
  const mcp = createMcpHandler(async () => {
    const server = new McpServer({ name: `pepys-${context.deployment.name}`, version: '1.0.0' });

    await registrar.register(server, { context });

    return server;
  });

  return new Elysia()
    .all('/rpc/*', { parse: 'none' }, async (route) => {
      const result = await rpc.handle(route.request, { prefix: '/rpc', context });

      return result.matched ? result.response : new Response('not found', { status: 404 });
    })
    .all('/mcp', { parse: 'none' }, (route) => mcp.fetch(route.request));
}
