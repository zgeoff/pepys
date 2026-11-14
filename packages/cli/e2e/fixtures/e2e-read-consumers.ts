import type { ConsumerDeclaration } from '@pepys/kit';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { telemetryModelRequestConsumer, telemetryTurnCostConsumer } from '@pepys/source-telemetry';
import { logbookVoyageConsumer } from 'logbook-plugin';
import { ledgerAccountConsumer } from '../../../testing/src/ledger/ledger-plugin.ts';

export interface ReadConsumer {
  consumer: ConsumerDeclaration;
  stream: string;
}

// Each consumer of the e2e deployment that a test reads, with the stream it reads. A run waits
// until each has applied the tail of its stream.
export const e2eReadConsumers: readonly ReadConsumer[] = [
  { consumer: githubPullRequestConsumer, stream: 'facts.github.pull_request' },
  { consumer: logbookVoyageConsumer, stream: 'facts.logbook.voyage' },
  { consumer: telemetryModelRequestConsumer, stream: 'facts.telemetry.log_record' },
  { consumer: telemetryTurnCostConsumer, stream: 'facts.telemetry.log_record' },
  { consumer: ledgerAccountConsumer, stream: 'facts.ledger.account' },
];
