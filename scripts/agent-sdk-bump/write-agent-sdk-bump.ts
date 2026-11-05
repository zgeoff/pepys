// Writes bumped=true to the file GITHUB_OUTPUT names when the pull request changes the Agent SDK
// releases that bun.lock holds, and bumped=false when it leaves them as they are.
import { appendFile } from 'node:fs/promises';
import { $ } from 'bun';
import { isAgentSDKBumped } from './is-agent-sdk-bumped.ts';

const outputFile = process.env['GITHUB_OUTPUT'];

if (outputFile === undefined) {
  console.error('needs GITHUB_OUTPUT set');
  process.exit(1);
}

// A pull_request run checks out the merge commit, whose first parent is the base branch.
const baseLockfile = await $`git show HEAD^1:bun.lock`.text();
const headLockfile = await Bun.file('bun.lock').text();

await appendFile(outputFile, `bumped=${isAgentSDKBumped(baseLockfile, headLockfile)}\n`);
