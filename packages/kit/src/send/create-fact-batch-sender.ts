import { z } from 'zod';
import { buildDeliveryProof } from '../delivery-checks/build-delivery-proof.ts';
import type { FactBatchBody, ReceivePath, SourceDefinition } from '../sources/types.ts';
import type { Result } from '../types.ts';
import type { OutgoingFact, SendFailure } from './types.ts';

interface FactBatchSenderOptions<Source extends SourceDefinition> {
  source: Source;
  url: string;
  secret: string;

  // Defaults to the global `fetch`. A route test passes ingest's own handler.
  fetch?: ((request: Request) => Promise<Response>) | undefined;
}

type FactBatchSender<Source extends SourceDefinition> = (
  facts: readonly OutgoingFact<Source>[],
) => Promise<Result<{ stored: number }, SendFailure>>;

const defaultFactLimit = 100;

// Signs each batch as the `check` of the source's receive path says, and sends it. A `retry` is
// every 5xx answer, a timeout or no connection: send the same batch again, unchanged. A `refused`
// is any other answer that is no success: the batch itself is wrong.
export function createFactBatchSender<Source extends SourceDefinition>(
  options: FactBatchSenderOptions<Source>,
): FactBatchSender<Source> {
  const path = options.source.live;

  if (path?.kind !== 'receive') {
    throw new Error(`the source ${options.source.name} has no receive path to send to`);
  }

  if (options.secret === '') {
    throw new Error(`the secret for the source ${options.source.name} is empty`);
  }

  const send = options.fetch ?? fetch;

  return async (facts) => {
    const factLimit = path.factLimit ?? defaultFactLimit;

    if (facts.length > factLimit) {
      return {
        ok: false,
        failure: {
          kind: 'refused',
          status: 413,
          reason: `${facts.length} facts is over the path's limit of ${factLimit}`,
        },
      };
    }

    const request = buildRequest(path, options.url, options.secret, facts);

    return await sendRequest(send, request);
  };
}

const sendTimeoutMs = 30_000;

function buildRequest(
  path: ReceivePath,
  url: string,
  secret: string,
  facts: readonly FactBatchBody['facts'][number][],
): Request {
  const batch: FactBatchBody = { v: 1, facts };

  // the bytes that are signed are the bytes that are sent
  const body = new TextEncoder().encode(JSON.stringify(batch));

  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [path.check.header]: buildDeliveryProof(path.check, secret, body),
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(sendTimeoutMs),
  });
}

async function sendRequest(
  send: (request: Request) => Promise<Response>,
  request: Request,
): Promise<Result<{ stored: number }, SendFailure>> {
  let answer: { status: number; text: string };

  try {
    const response = await send(request);
    const text = await response.text();

    answer = { status: response.status, text };
  } catch (error) {
    return { ok: false, failure: { kind: 'retry', reason: String(error) } };
  }

  return pickSendResult(answer.status, answer.text);
}

const answerSchema = z.union([
  z.object({ status: z.literal('stored'), stored: z.number().int().nonnegative() }),
  z.object({ status: z.literal('ignored') }),
]);

function pickSendResult(status: number, text: string): Result<{ stored: number }, SendFailure> {
  if (status >= 500) {
    return { ok: false, failure: { kind: 'retry', reason: `ingest answered ${status}: ${text}` } };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, failure: { kind: 'refused', status, reason: text } };
  }

  const json = parseJSON(text);
  const answer = answerSchema.safeParse(json);

  // A success that names no count may still have stored the batch, and a repeat is safe, because
  // every consumer drops a copy by its fact ID.
  if (!answer.success) {
    return { ok: false, failure: { kind: 'retry', reason: `ingest answered ${status}: ${text}` } };
  }

  return { ok: true, value: { stored: answer.data.status === 'stored' ? answer.data.stored : 0 } };
}

function parseJSON(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);

    return value;
  } catch {
    return undefined;
  }
}
