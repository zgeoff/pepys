import { createHash } from 'node:crypto';
import { isDeliveryAuthentic } from '@pepys/kit';
import type {
  ReceivePath,
  Received,
  Sender,
  SenderProof,
  SenderRequirement,
  SourceDefinition,
} from '@pepys/kit';
import { match } from 'ts-pattern';
import type { BatchAppender } from '../fact-log/make-batch-appender.ts';
import { buildFailureAnswer, buildRetryAnswer } from './answers/build-failure-answer.ts';
import { buildSuccessAnswer } from './answers/build-success-answer.ts';
import { findBatchProblem } from './find-batch-problem.ts';
import { planBatch } from './plan-batch.ts';
import { readDecodedBody } from './read-decoded-body.ts';
import { readSentBody } from './read-sent-body.ts';
import type { RecentBodies } from './recent-bodies/create-recent-bodies.ts';
import type { SourceMarks } from './resync-marks/create-resync-marks.ts';
import { writeBatch } from './write-batch.ts';
import type { StreamTurns } from './write-batch.ts';

export interface ReceiveDependencies {
  // the value of the path's `check.secretEnv`; an empty secret passes no delivery
  secret: string;
  senderProof: SenderProof;
  append: BatchAppender;
  turns: StreamTurns;
  recentBodies: RecentBodies;

  // null for a source with no resync pull, which reads no marks
  marks: SourceMarks | null;
}

type Handler = (request: Request) => Promise<Response>;

const defaultBodyByteLimit = 1_048_576;
const defaultFactLimit = 100;

// One delivery on the route of a receive path. Each step answers and stops, or goes on.
export function makeReceiveHandler(
  source: SourceDefinition,
  path: ReceivePath,
  dependencies: ReceiveDependencies,
): Handler {
  const byteLimit = path.bodyByteLimit ?? defaultBodyByteLimit;
  const factLimit = path.factLimit ?? defaultFactLimit;

  return async (request) => {
    const checked = await readCheckedDelivery(request, path, dependencies);

    if (checked.kind === 'answer') {
      return checked.answer;
    }

    // The same answer as the first time, with no append, for a body this route stored in the last
    // hour. A body is remembered only once it is stored, so a delivery that got 503 is never dropped.
    const digest = createHash('sha256').update(checked.sent).digest('hex');
    const key = buildRecentBodyKey(digest, checked.sender);
    const known = dependencies.recentBodies.find(key);

    if (known !== undefined) {
      dependencies.marks?.noteCopy(digest, known.entities);

      return buildSuccessAnswer(path, 'stored', known.stored);
    }

    const body = await readDecodedBody(
      checked.sent,
      request.headers.get('content-encoding'),
      path.encodings ?? [],
      byteLimit,
    );

    if (typeof body === 'string') {
      return pickDecodeFailure(body);
    }

    const received = readSourceDelivery(source, path, {
      headers: request.headers,
      body,
      ...(checked.sender === undefined ? {} : { sender: checked.sender }),
    });

    if (received === 'threw') {
      return buildFailureAnswer(500, 'the source could not read the delivery');
    }

    if (received.kind === 'refused') {
      return buildFailureAnswer(received.status, received.reason);
    }

    if (received.kind === 'ignored' || received.batch.facts.length === 0) {
      return buildSuccessAnswer(path, 'ignored', 0);
    }

    const facts = received.batch.facts;

    if (facts.length > factLimit) {
      return buildFailureAnswer(413, `a batch holds ${factLimit} facts at most`);
    }

    const problem = findBatchProblem(source, received.batch);

    if (problem !== undefined) {
      return buildFailureAnswer(422, problem);
    }

    if (facts.some((pending) => pending.blobs.length > 0)) {
      console.error(
        `the source ${source.name} read a fact with a blob, and ingest has no blob store`,
      );

      return buildFailureAnswer(500, 'ingest has no blob store');
    }

    const plan = planBatch(received.batch);

    if (!plan.ok) {
      return buildFailureAnswer(413, 'one fact is larger than one append of the log takes');
    }

    const outcome = await writeBatch(plan.value, dependencies);

    if (outcome === 'not-stored') {
      return buildRetryAnswer();
    }

    if (outcome === 'refused') {
      return buildFailureAnswer(500, 'the log refused the batch');
    }

    const entities = facts.map((pending) => pending.fact.entity);

    dependencies.recentBodies.remember(key, { stored: facts.length, entities });

    dependencies.marks?.noteStored(
      digest,
      facts.map((pending) => ({
        entity: pending.fact.entity,
        at: pending.fact.at,
        locator: pending.locator,
      })),
    );

    return buildSuccessAnswer(path, 'stored', facts.length);
  };
}

// A route of the path's `ignoredRoutes`: the same method, size, check and sender as the path, then
// the ignored answer. It reads no body further and stores nothing.
export function makeIgnoredRouteHandler(
  path: ReceivePath,
  dependencies: Pick<ReceiveDependencies, 'secret' | 'senderProof'>,
): Handler {
  return async (request) => {
    const checked = await readCheckedDelivery(request, path, dependencies);

    return checked.kind === 'answer' ? checked.answer : buildSuccessAnswer(path, 'ignored', 0);
  };
}

type CheckedDelivery =
  | { kind: 'answer'; answer: Response }
  | { kind: 'checked'; sent: Uint8Array; sender: Sender | undefined };

// 405, 413, then 401 unless the check passes on the bytes as sent, then 401 unless the sender is
// proven on a path that needs one. No code of the source has seen the delivery yet.
async function readCheckedDelivery(
  request: Request,
  path: ReceivePath,
  dependencies: Pick<ReceiveDependencies, 'secret' | 'senderProof'>,
): Promise<CheckedDelivery> {
  if (request.method !== 'POST') {
    return { kind: 'answer', answer: buildFailureAnswer(405, 'method not allowed') };
  }

  const sent = await readSentBody(request, path.bodyByteLimit ?? defaultBodyByteLimit);

  if (sent === 'too-large') {
    return { kind: 'answer', answer: buildFailureAnswer(413, 'body too large') };
  }

  if (!isDeliveryAuthentic(path.check, dependencies.secret, request.headers, sent)) {
    return { kind: 'answer', answer: buildFailureAnswer(401, 'not authorised') };
  }

  if (path.sender === undefined) {
    return { kind: 'checked', sent, sender: undefined };
  }

  const sender = await readProvenSender(path.sender, request.headers, dependencies.senderProof);

  if (sender === null) {
    return { kind: 'answer', answer: buildFailureAnswer(401, 'not authorised') };
  }

  return { kind: 'checked', sent, sender };
}

// A proof that throws proves nothing. The error may quote the request, so only its fact is logged.
async function readProvenSender(
  requirement: SenderRequirement,
  headers: Headers,
  senderProof: SenderProof,
): Promise<Sender | null> {
  try {
    const sender = await senderProof.prove(requirement, headers);

    return sender;
  } catch {
    console.error('the sender proof threw, so the delivery proves no sender');

    return null;
  }
}

// On a path with a sender, one body from two senders is two deliveries.
function buildRecentBodyKey(digest: string, sender: Sender | undefined): string {
  return sender === undefined ? digest : JSON.stringify([digest, sender.issuer, sender.subject]);
}

function pickDecodeFailure(failure: 'unsupported' | 'too-large' | 'corrupt'): Response {
  return match(failure)
    .with('unsupported', () => buildFailureAnswer(415, 'content encoding not accepted'))
    .with('too-large', () => buildFailureAnswer(413, 'body too large'))
    .with('corrupt', () => buildFailureAnswer(400, 'the body does not decode'))
    .exhaustive();
}

// The source's own code. It is pure, so a throw is a fault of the deployment.
function readSourceDelivery(
  source: SourceDefinition,
  path: ReceivePath,
  delivery: Parameters<ReceivePath['read']>[0],
): Received | 'threw' {
  try {
    return path.read(delivery, { name: source.name, families: source.families });
  } catch (error: unknown) {
    console.error(`the read of the source ${source.name} threw`, error);

    return 'threw';
  }
}
