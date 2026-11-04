import type { Batch, StreamRow } from './create-change-log.ts';
import { formatOffset } from './format-offset.ts';
import { toMediaType } from './to-media-type.ts';
import { toReadBody } from './to-read-body.ts';
import type { ReadTarget } from './types.ts';

const textEncoder = new TextEncoder();

// Each chunk goes out as a data event and a control event. At the tail the stream waits for the
// next commit, and it ends when the stream closes or the connection reaches its time limit.
export function handleSSERead(target: ReadTarget): Response {
  const encoding = pickSSEEncoding(target.stream.contentType);

  const headers = new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });

  if (encoding === 'base64') {
    headers.set('stream-sse-data-encoding', 'base64');
  }

  const body = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      await writeEvents(target, encoding, (text) => controller.enqueue(textEncoder.encode(text)));

      controller.close();
    },
  });

  return new Response(body, { status: 200, headers });
}

type SSEEncoding = 'text' | 'base64';

function pickSSEEncoding(contentType: string): SSEEncoding {
  const mediaType = toMediaType(contentType);

  return mediaType === 'application/json' || mediaType.startsWith('text/') ? 'text' : 'base64';
}

async function writeEvents(
  target: ReadTarget,
  encoding: SSEEncoding,
  write: (text: string) => void,
): Promise<void> {
  const options = target.ctx.options;
  const deadline = Date.now() + options.sseConnectionMs;
  let after = target.after;
  let current: StreamRow | null = target.stream;

  while (current !== null && !target.request.signal.aborted) {
    const batches = await options.changeLog.readBatches(
      current.streamID,
      after,
      options.maxChunkBytes,
    );

    if (batches.length > 0) {
      write(formatSSEData(encoding, current.contentType, batches));

      after = batches.at(-1)?.batch ?? after;
    }

    const isAtTail = after >= current.tail;

    if (batches.length > 0 || isAtTail) {
      write(formatSSEControl(current, after, isAtTail, target.cursor));
    }

    const remainingMs = deadline - Date.now();

    if (isAtTail && (current.closed || remainingMs <= 0)) {
      return;
    }

    if (isAtTail) {
      await target.ctx.waitForCommit(current.path, remainingMs, target.request.signal);

      current = await options.changeLog.readStream(current.path);
    }
  }
}

const textDecoder = new TextDecoder();

// Each line of the payload gets its own data field, so an embedded CR or LF can never end the
// event early.
function formatSSEData(
  encoding: SSEEncoding,
  contentType: string,
  batches: readonly Batch[],
): string {
  const payload = toReadBody(contentType, batches);

  const text =
    encoding === 'base64' ? Buffer.from(payload).toString('base64') : textDecoder.decode(payload);

  const lines = text.split(/\r\n|\r|\n/u).map((line) => `data:${line}`);

  return `event: data\n${lines.join('\n')}\n\n`;
}

function formatSSEControl(
  stream: StreamRow,
  after: number,
  isAtTail: boolean,
  cursor: string,
): string {
  const isClosed = isAtTail && stream.closed;

  const control = {
    streamNextOffset: formatOffset(after),
    ...(isClosed ? { streamClosed: true } : { streamCursor: cursor }),
    ...(isAtTail ? { upToDate: true } : {}),
  };

  return `event: control\ndata:${JSON.stringify(control)}\n\n`;
}
