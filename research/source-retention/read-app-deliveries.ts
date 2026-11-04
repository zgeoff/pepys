import { createSign } from 'node:crypto';
import { z } from 'zod';

export interface AppCredentials {
  readonly appID: string;
  readonly privateKeyPEM: string;
}

export interface Delivery {
  readonly deliveredAt: Date;
  readonly statusCode: number;
  readonly redelivery: boolean;
}

const deliveriesURL = 'https://api.github.com/app/hook/deliveries?per_page=100';

const deliveryPageSchema = z.array(
  z.object({
    delivered_at: z.iso.datetime({ offset: true }),
    status_code: z.number(),
    redelivery: z.boolean(),
  }),
);

// Reads every delivery the App's webhook log still returns, following the cursor in each Link header.
export async function readAppDeliveries(credentials: AppCredentials): Promise<Delivery[]> {
  const jwt = buildAppJWT(credentials, new Date());
  const deliveries: Delivery[] = [];
  let pageURL: string | null = deliveriesURL;

  while (pageURL !== null) {
    const response: Response = await fetch(pageURL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });

    if (!response.ok) {
      throw new Error(`GET ${pageURL} returned HTTP ${response.status}: ${await response.text()}`);
    }

    const body: unknown = await response.json();

    const page = deliveryPageSchema.parse(body);

    for (const delivery of page) {
      deliveries.push({
        deliveredAt: new Date(delivery.delivered_at),
        statusCode: delivery.status_code,
        redelivery: delivery.redelivery,
      });
    }

    pageURL = findNextPageURL(response.headers.get('link'));
  }

  return deliveries;
}

function buildAppJWT(credentials: AppCredentials, now: Date): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);

  // GitHub rejects a JWT that lives longer than 10 minutes, and allows 60 s of clock drift.
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: nowSeconds - 60, exp: nowSeconds + 540, iss: credentials.appID };
  const unsigned = `${toBase64URL(JSON.stringify(header))}.${toBase64URL(JSON.stringify(payload))}`;

  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.privateKeyPEM, 'base64url');

  return `${unsigned}.${signature}`;
}

function toBase64URL(text: string): string {
  return Buffer.from(text).toString('base64url');
}

function findNextPageURL(linkHeader: string | null): string | null {
  const next = linkHeader?.split(',').find((part) => part.includes('rel="next"'));
  const url = next?.match(/<(?<url>[^>]+)>/u)?.groups?.['url'];

  return url ?? null;
}
