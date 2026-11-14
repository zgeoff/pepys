import { Webhooks } from '@octokit/webhooks';
import type { GithubDelivery } from './build-github-delivery.ts';
import { e2eSecrets } from './e2e-secrets.ts';

// Signs the delivery with the e2e deployment's webhook secret, as GitHub does, and sends it to
// ingest's GitHub route. It throws unless ingest answers 200.
export async function writeGithubDelivery(url: string, delivery: GithubDelivery): Promise<void> {
  const signature = await new Webhooks({ secret: e2eSecrets.githubWebhook }).sign(delivery.body);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': delivery.event,
      'x-github-delivery': delivery.deliveryID,
    },
    body: delivery.body,
  });

  if (response.status !== 200) {
    throw new Error(`ingest answered ${response.status} to ${delivery.deliveryID}`);
  }
}
