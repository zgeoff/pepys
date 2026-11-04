import { buildMetadataHeaders } from './build-metadata-headers.ts';
import type { ChangeLog, StreamRow } from './create-change-log.ts';
import { handleAppend } from './handle-append.ts';
import { handleCreate } from './handle-create.ts';
import { handleRead } from './handle-read.ts';
import type { ChangeFeedServerOptions, HandlerContext } from './types.ts';

export interface ChangeFeedServer {
  readonly url: string;

  // The host's after-commit signal: a write that bypasses HTTP calls it to wake live readers.
  notifyCommit: (path: string) => void;

  // True while a live reader of the stream waits for the next commit.
  hasWaiter: (path: string) => boolean;
  stop: () => Promise<void>;
}

const baseHeaders = {
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'stream-next-offset, stream-cursor, stream-up-to-date, stream-closed, stream-ttl, stream-expires-at, stream-sse-data-encoding, etag, location, content-type',
};

// GET and HEAD are the read side that the pepys API would serve. PUT, POST and DELETE are a test
// fixture: every read test in the conformance suite creates and fills its stream through them.
export function createChangeFeedServer(options: ChangeFeedServerOptions): ChangeFeedServer {
  const waiters = new Map<string, Set<() => void>>();

  const notifyCommit = (path: string): void => {
    const pending = waiters.get(path);

    waiters.delete(path);

    for (const wake of pending ?? []) {
      wake();
    }
  };

  const waitForCommit = async (path: string, timeoutMs: number, signal: AbortSignal) => {
    const woken = Promise.withResolvers<boolean>();
    const pending = waiters.get(path) ?? new Set<() => void>();

    const wake = () => {
      woken.resolve(true);
    };

    const abort = () => {
      woken.resolve(false);
    };

    const timer = setTimeout(abort, timeoutMs);

    pending.add(wake);
    waiters.set(path, pending);
    signal.addEventListener('abort', abort, { once: true });

    const isWoken = await woken.promise;

    clearTimeout(timer);

    pending.delete(wake);
    signal.removeEventListener('abort', abort);

    return isWoken;
  };

  const ctx: HandlerContext = { options, notifyCommit, waitForCommit };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port,
    idleTimeout: 0,

    // Bun.serve fixes this name
    // oxlint-disable-next-line zgeoff/function-verb
    fetch: async (request) => {
      const response = await handleRequest(ctx, request);

      for (const [name, value] of Object.entries(baseHeaders)) {
        response.headers.set(name, value);
      }

      return response;
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    notifyCommit,
    hasWaiter: (path) => (waiters.get(path)?.size ?? 0) > 0,
    stop: () => server.stop(true),
  };
}

async function handleRequest(ctx: HandlerContext, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-methods': 'GET, HEAD, PUT, POST, DELETE, OPTIONS',
        'access-control-allow-headers':
          'content-type, if-none-match, stream-seq, stream-ttl, stream-expires-at, stream-closed',
      },
    });
  }

  const nowMs = Date.now();

  const stream = await readLiveStream(ctx.options.changeLog, path, nowMs);

  if (request.method === 'PUT') {
    return handleCreate({ ctx, request, path, existing: stream, nowMs });
  }

  if (stream === null) {
    return new Response('stream not found', { status: 404 });
  }

  if (request.method === 'POST') {
    return handleAppend(ctx, request, stream, nowMs);
  }

  if (request.method === 'DELETE') {
    await ctx.options.changeLog.removeStream(path);

    ctx.notifyCommit(path);

    return new Response(null, { status: 204 });
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: buildMetadataHeaders(stream) });
  }

  if (request.method === 'GET') {
    await ctx.options.changeLog.writeTouch(path, nowMs);

    return handleRead(ctx, request, stream);
  }

  return new Response('method not allowed', { status: 405 });
}

// An expired stream reads as missing, and the access that finds it expired removes it.
async function readLiveStream(
  changeLog: ChangeLog,
  path: string,
  nowMs: number,
): Promise<StreamRow | null> {
  const stream = await changeLog.readStream(path);

  if (stream === null || !isExpired(stream, nowMs)) {
    return stream;
  }

  await changeLog.removeStream(path);

  return null;
}

function isExpired(stream: StreamRow, nowMs: number): boolean {
  if (stream.expiresAt !== null && Date.parse(stream.expiresAt) <= nowMs) {
    return true;
  }

  return stream.ttlSeconds !== null && stream.touchedMs + stream.ttlSeconds * 1000 <= nowMs;
}
