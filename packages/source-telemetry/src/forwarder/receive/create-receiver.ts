import type { Logger } from '@pepys/kit';
import type { SendState } from '../send/types.ts';
import { buildSpoolLine } from '../spool/build-spool-line.ts';
import { isJSONContentType, parseReceivedBody } from './parse-received-body.ts';

interface ReceiverOptions {
  // Resolves once the text is on disk.
  append: (text: string) => Promise<void>;
  readState: () => SendState;
  now: () => number;
  logger: Logger;

  // Called after each stored export.
  onStored: () => void;
}

const exportPaths = new Set(['/v1/logs', '/v1/metrics', '/v1/traces']);

// The OTLP receiver and `GET /health`, as one fetch function with no listener.
export function createReceiver(options: ReceiverOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const pathname = new URL(request.url).pathname;

    if (pathname === '/health' && request.method === 'GET') {
      const state = options.readState();

      return Response.json(state, { status: state.send === 'stopped' ? 503 : 200 });
    }

    if (!exportPaths.has(pathname)) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'use POST' }, { status: 405 });
    }

    if (!isJSONContentType(request.headers.get('content-type'))) {
      return Response.json({ error: 'the body must be application/json' }, { status: 415 });
    }

    const buffer = await request.arrayBuffer();

    const bytes = new Uint8Array(buffer);

    const parsed = parseReceivedBody(bytes, request.headers.get('content-encoding'));

    if (!parsed.ok) {
      return Response.json({ error: 'the body is not JSON' }, { status: 400 });
    }

    if (pathname !== '/v1/logs') {
      return Response.json({});
    }

    try {
      await options.append(
        buildSpoolLine({
          nowMs: options.now(),
          userAgent: request.headers.get('user-agent'),
          body: parsed.body,
        }),
      );
    } catch (error) {
      options.logger.error('the receiver could not append an export to the spool', {
        reason: error instanceof Error ? error.message : 'unknown',
      });

      return Response.json({ error: 'the export is not stored' }, { status: 503 });
    }

    options.onStored();

    return Response.json({});
  };
}
