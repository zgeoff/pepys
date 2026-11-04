import { buildMetadataHeaders } from './build-metadata-headers.ts';
import type { StreamRow } from './create-change-log.ts';
import { isClosedHeader } from './is-closed-header.ts';
import { parseAppendBody } from './parse-append-body.ts';
import { toMediaType } from './to-media-type.ts';
import type { HandlerContext } from './types.ts';

export interface CreateRequest {
  readonly ctx: HandlerContext;
  readonly request: Request;
  readonly path: string;
  readonly existing: StreamRow | null;
  readonly nowMs: number;
}

// Test fixture only: the conformance suite creates every stream it reads with PUT.
export async function handleCreate(create: CreateRequest): Promise<Response> {
  const config = parseCreateHeaders(create.request.headers);

  if (config === null) {
    return new Response('invalid stream headers', { status: 400 });
  }

  if (create.existing !== null) {
    return isSameConfig(create.existing, config)
      ? new Response(null, { status: 200, headers: buildMetadataHeaders(create.existing) })
      : new Response('stream exists with another config', { status: 409 });
  }

  const buffer = await create.request.arrayBuffer();

  const initial = parseAppendBody(config.contentType, new Uint8Array(buffer), true);

  if (initial.kind === 'invalid') {
    return new Response(initial.reason, { status: 400 });
  }

  const created = await create.ctx.options.changeLog.createStream({
    path: create.path,
    contentType: config.contentType,
    closed: config.closed,
    ttlSeconds: config.ttlSeconds,
    expiresAt: config.expiresAt,
    initial: initial.kind === 'data' ? initial.data : null,
    nowMs: create.nowMs,
  });

  const headers = buildMetadataHeaders(created);

  headers.set('location', create.request.url);
  headers.delete('cache-control');

  return new Response(null, { status: 201, headers });
}

interface CreateConfig {
  readonly contentType: string;
  readonly ttlSeconds: number | null;
  readonly expiresAt: string | null;
  readonly closed: boolean;
}

function parseCreateHeaders(headers: Headers): CreateConfig | null {
  const ttl = headers.get('stream-ttl');
  const expiresAt = headers.get('stream-expires-at');

  if (ttl !== null && expiresAt !== null) {
    return null;
  }

  if (ttl !== null && !/^(?:0|[1-9]\d*)$/u.test(ttl)) {
    return null;
  }

  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
    return null;
  }

  return {
    contentType: headers.get('content-type') ?? 'application/octet-stream',
    ttlSeconds: ttl === null ? null : Number(ttl),
    expiresAt,
    closed: isClosedHeader(headers),
  };
}

function isSameConfig(existing: StreamRow, config: CreateConfig): boolean {
  return (
    toMediaType(existing.contentType) === toMediaType(config.contentType) &&
    existing.ttlSeconds === config.ttlSeconds &&
    existing.expiresAt === config.expiresAt &&
    existing.closed === config.closed
  );
}
