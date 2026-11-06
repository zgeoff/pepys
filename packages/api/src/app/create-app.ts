import { ORPCError, ValidationError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Elysia } from 'elysia';
import type { QueryContext } from '../queries/types.ts';
import { createRouter } from './create-router.ts';

export function createApp(context: QueryContext) {
  const handler = new RPCHandler(createRouter(), {
    clientInterceptors: [
      async (options) => {
        try {
          return await options.next();
        } catch (error) {
          if (isMissingEvidence(options.path, error)) {
            throw new ORPCError('UNPROCESSABLE_CONTENT', {
              defined: true,
              status: 422,
              message: 'a link needs evidence',
              cause: error,
            });
          }

          throw error;
        }
      },
    ],
  });

  return new Elysia().all('/rpc/*', { parse: 'none' }, async (route) => {
    const result = await handler.handle(route.request, { prefix: '/rpc', context });

    return result.matched ? result.response : new Response('not found', { status: 404 });
  });
}

// oRPC refuses every input that fails its schema with HTTP 400, and the auth design gives a link
// with no evidence HTTP 422.
function isMissingEvidence(path: readonly string[], error: unknown): boolean {
  return (
    path.join('.') === 'assert_link' &&
    error instanceof ORPCError &&
    error.cause instanceof ValidationError &&
    error.cause.issues.some((issue) => issue.path?.[0] === 'evidence')
  );
}
