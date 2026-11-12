import { planAppends } from '@pepys/ingest';
import type { PendingFact, PullContext, Pulled } from '@pepys/kit';
import { z } from 'zod';
import { buildGithubFact } from '../build-github-fact.ts';
import { findAppJWT } from '../github-app/find-app-jwt.ts';
import { pickPullFailure } from '../github-app/pick-pull-failure.ts';
import { requestGithubAPI } from '../github-app/request-github-api.ts';
import type { GithubAnswer } from '../github-app/request-github-api.ts';

const deliveryDetailSchema = z.looseObject({
  event: z.string(),
  request: z.looseObject({ payload: z.unknown() }),
});

// The recovery pull: each delivery of the App's webhook that got no 2xx answer, read from GitHub's
// delivery log and built as the receive path builds it, so a delivery that did arrive is a copy.
// The cursor is the highest delivery ID seen; GitHub keeps deliveries for 3 days.
export async function pullFailedDeliveries(
  cursor: string | null,
  context: PullContext,
): Promise<Pulled> {
  const appJWT = findAppJWT(context.env, context.now());

  if (appJWT === undefined) {
    return { kind: 'rejected', reason: 'the GitHub App private key cannot sign a token' };
  }

  const seenID = cursor === null ? 0n : BigInt(cursor);

  const listed = await readDeliveriesAfter(seenID, appJWT);

  if (listed.kind !== 'listed') {
    return pickPullFailure(listed.status);
  }

  const facts: PendingFact[] = [];

  for (const id of collectFailedIDs(listed.items)) {
    const answer = await requestGithubAPI(`/app/hook/deliveries/${id}`, appJWT);

    const detail = deliveryDetailSchema.safeParse(answer.body);

    if (answer.status !== 200 || !detail.success) {
      return pickPullFailure(answer.status);
    }

    const fact = buildGithubFact(detail.data.event, detail.data.request.payload, {
      kind: 'delivery',
    });

    if (fact === 'ignored' || fact === 'invalid') {
      continue;
    }

    // The receive path answers 413 to a body this large and stores nothing; a batch that held it
    // would be refused whole, with every other delivery and the cursor.
    if (!planAppends([fact.fact]).ok) {
      console.error(`the GitHub delivery ${id} is larger than one append of the log takes`);
      continue;
    }

    facts.push(fact);
  }

  const highestID = listed.items.reduce(
    (highest, item) => (item.id > highest ? item.id : highest),
    seenID,
  );

  return { kind: 'batch', batch: { facts }, cursor: `${highestID}`, isDone: true };
}

// A delivery ID is above 2^53, so it is read from its digits in the body, never from a number.
const deliveryItemSchema = z.looseObject({
  id: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(BigInt),
  status_code: z.number().int(),
  event: z.string(),
});

const deliveryListSchema = z.array(deliveryItemSchema);

type DeliveryItem = z.infer<typeof deliveryItemSchema>;

type DeliveryList = { kind: 'listed'; items: DeliveryItem[] } | { kind: 'failed'; status: number };

// GitHub lists the newest delivery first, so the pages stop at the first one already seen.
async function readDeliveriesAfter(seenID: bigint, appJWT: string): Promise<DeliveryList> {
  const items: DeliveryItem[] = [];
  let url: string | undefined = '/app/hook/deliveries?per_page=100';

  while (url !== undefined) {
    const answer: GithubAnswer = await requestGithubAPI(url, appJWT);

    const page = deliveryListSchema.safeParse(parseDeliveryList(answer.text));

    if (answer.status !== 200 || !page.success) {
      return { kind: 'failed', status: answer.status };
    }

    const unseen = page.data.filter((item) => item.id > seenID);

    items.push(...unseen);

    url = unseen.length < page.data.length ? undefined : answer.next;
  }

  return { kind: 'listed', items };
}

interface ReviverContext {
  source?: string;
}

// `JSON.parse` rounds a number above 2^53, so each `id` keeps the source text the reviver is given.
function parseDeliveryList(text: string): unknown {
  try {
    const list: unknown = JSON.parse(
      text,
      (key: string, value: unknown, context?: ReviverContext): unknown =>
        key === 'id' && typeof value === 'number' ? context?.source : value,
    );

    return list;
  } catch {
    return undefined;
  }
}

// oldest first, so the facts reach the log in the order GitHub sent them
function collectFailedIDs(items: readonly DeliveryItem[]): bigint[] {
  return items
    .filter((item) => item.status_code < 200 || item.status_code >= 300)
    .map((item) => item.id)
    .toSorted((left, right) => Number(left - right));
}
