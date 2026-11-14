import { createFactBatchSender } from '@pepys/kit/send';
import { WringerError } from '@wringer/core';
import { logbookSource } from 'logbook-plugin';
import { buildPullRequestFields } from '../../packages/cli/e2e/fixtures/build-pull-request-fields.ts';
import { e2eSecrets } from '../../packages/cli/e2e/fixtures/e2e-secrets.ts';

export interface VoyageInput {
  voyage: string;
  title: string;

  // the number of the invented pull request the voyage cites
  cites: number;
  at: string;
}

// Sends one signed fact batch of the e2e deployment's logbook plug-in: a voyage in Port Coral that
// cites the pull request, which the logbook's consumer links to it.
export async function writeVoyage(ingestURL: string, input: VoyageInput) {
  const send = createFactBatchSender({
    source: logbookSource,
    url: new URL('/logbook/facts', ingestURL).href,
    secret: e2eSecrets.logbook,
  });

  const sent = await send([
    {
      type: 'logbook.voyage.logged',
      event: `verify-${input.voyage}`,
      entity: `logbook:voyage:${input.voyage}`,
      at: input.at,
      payload: {
        title: input.title,
        harbour: 'Port Coral',
        cites: buildPullRequestFields(input.cites, input.at).id,
      },
    },
  ]);

  if (!sent.ok) {
    throw new WringerError('check-failed', {
      message: `ingest refused the logbook batch: ${JSON.stringify(sent.failure)}`,
    });
  }

  return { voyage: `logbook:voyage:${input.voyage}` };
}
