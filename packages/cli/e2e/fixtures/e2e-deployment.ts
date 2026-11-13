import { defineDeployment } from '@pepys/kit';
import { githubPlugin } from '@pepys/source-github';
import { telemetryPlugin } from '@pepys/source-telemetry';
import { logbookPlugin } from 'logbook-plugin';
import { ledgerPlugin } from '../../../testing/src/ledger/ledger-plugin.ts';

// The deployment of the e2e lane: two pepys plug-ins, one from outside the packages, and the stub
// scope consumer. `bun run consumers:build` compiles it, and ingest, the host and the API of the
// lane run it.
export const e2eDeployment = defineDeployment({
  name: 'e2e',
  plugins: [githubPlugin, telemetryPlugin, logbookPlugin, ledgerPlugin],
});
