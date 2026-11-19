import { defineDeployment } from '@pepys/kit';
import { githubPlugin } from '@pepys/source-github';
import { dockPlugin } from '../packages/testing/src/dock/dock-plugin.ts';
import { ledgerPlugin } from '../packages/testing/src/ledger/ledger-plugin.ts';

// The repo's own deployment: `bun run consumers:build` builds it, the Rust e2e lane runs it, and
// `bun run schema:generate` writes its generated files. The ledger and dock plug-ins are its stub
// scope consumers. The GitHub plug-in stays first: the host's tests read the first consumer.
export const stubDeployment = defineDeployment({
  name: 'stub',
  plugins: [githubPlugin, ledgerPlugin, dockPlugin],
});
