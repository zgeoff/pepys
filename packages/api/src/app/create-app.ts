import { RPCHandler } from '@orpc/server/fetch';
import { Elysia } from 'elysia';
import type { QueryContext } from '../queries/types.ts';
import { createRouter } from './create-router.ts';

export function createApp(context: QueryContext) {
  const handler = new RPCHandler(createRouter());

  return new Elysia().all('/rpc/*', { parse: 'none' }, async (route) => {
    const result = await handler.handle(route.request, { prefix: '/rpc', context });

    return result.matched ? result.response : new Response('not found', { status: 404 });
  });
}
