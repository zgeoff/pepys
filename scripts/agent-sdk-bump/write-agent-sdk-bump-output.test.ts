import { expect, mock, test } from 'bun:test';
import { writeAgentSDKBumpOutput } from './write-agent-sdk-bump-output.ts';

test('it writes bumped=true when the head lockfile holds a new SDK release', async () => {
  const writeOutput = mock(() => Promise.resolve());

  await writeAgentSDKBumpOutput({
    readBaseLockfile: () =>
      Promise.resolve(
        `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
      ),
    readHeadLockfile: () =>
      Promise.resolve(
        `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.2", "", {}, "sha512-b"], }, }`,
      ),
    writeOutput,
  });

  expect(writeOutput).toHaveBeenCalledExactlyOnceWith('bumped=true\n');
});

test('it writes bumped=false when the head lockfile keeps the SDK release', async () => {
  const writeOutput = mock(() => Promise.resolve());

  await writeAgentSDKBumpOutput({
    readBaseLockfile: () =>
      Promise.resolve(
        `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.6", "", {}, "sha512-j"], }, }`,
      ),
    readHeadLockfile: () =>
      Promise.resolve(
        `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], }, }`,
      ),
    writeOutput,
  });

  expect(writeOutput).toHaveBeenCalledExactlyOnceWith('bumped=false\n');
});
