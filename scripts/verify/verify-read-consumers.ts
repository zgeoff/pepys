import { githubDeliveryConsumers } from '@pepys/source-github';
import { e2eReadConsumers } from '../../packages/cli/e2e/fixtures/e2e-read-consumers.ts';
import type { ReadConsumer } from '../../packages/cli/e2e/fixtures/e2e-read-consumers.ts';

// the package exports the releases' consumer only in this list, second
const [, githubReleaseConsumer] = githubDeliveryConsumers;

// Each consumer that a journey reads, with the stream it reads: those of the e2e lane, and the
// releases that the delivery query joins.
export const verifyReadConsumers: readonly ReadConsumer[] = [
  ...e2eReadConsumers,
  { consumer: githubReleaseConsumer, stream: 'facts.github.release' },
];
