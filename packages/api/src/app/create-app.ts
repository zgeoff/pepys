import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { McpRegistrar } from '@orpc/mcp';
import { COMMON_ERROR_STATUS_MAP, ORPCError, onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Elysia } from 'elysia';
import type { QueryContext } from '../queries/types.ts';
import { createRouter } from './create-router.ts';

interface AppDependencies {
  logError: (message: string, error: unknown) => void;
}

// The router at /rpc, and each of its procedures as an MCP tool at /mcp.
export function createApp(context: QueryContext, dependencies: AppDependencies) {
  const router = createRouter(context.deployment.queries);

  // A contract's own status has no effect in oRPC v2: the handler's map gives each code its HTTP
  // status, and a code the map lacks gets 400. The map sets 503 itself, so it rests on no default.
  const rpc = new RPCHandler(router, {
    errorStatusMap: { ...COMMON_ERROR_STATUS_MAP, SERVICE_UNAVAILABLE: 503 },
    clientInterceptors: [onError(makeErrorLog('/rpc', dependencies.logError))],
  });

  const registrar = new McpRegistrar(router, {
    clientInterceptors: [onError(makeErrorLog('/mcp', dependencies.logError))],
  });

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

interface ProcedureCall {
  path: readonly string[];
}

// Both transports answer an unexpected error with a bare 500 or error result, so the server log
// is the only place its cause shows.
function makeErrorLog(transport: string, logError: AppDependencies['logError']) {
  return (error: unknown, call: ProcedureCall): void => {
    if (isUnexpectedError(error)) {
      logError(`the ${transport} call of ${call.path.join('.')} failed`, error);
    }
  };
}

// oRPC throws a failed output check as INTERNAL_SERVER_ERROR, a fault of the server's own.
function isUnexpectedError(error: unknown): boolean {
  return !(error instanceof ORPCError) || error.code === 'INTERNAL_SERVER_ERROR';
}
