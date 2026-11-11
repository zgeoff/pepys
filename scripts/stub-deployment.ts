import { defineDeployment } from '@pepys/kit';
import { githubPlugin } from '@pepys/source-github';

// The repo's own deployment: `bun run consumers:build` builds it, the e2e lane runs it, and
// `bun run schema:generate` writes its generated files.
export const stubDeployment = defineDeployment({ name: 'stub', plugins: [githubPlugin] });
