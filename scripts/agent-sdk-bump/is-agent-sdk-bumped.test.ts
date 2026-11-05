import { expect, test } from 'bun:test';
import { isAgentSDKBumped } from './is-agent-sdk-bumped.ts';

test.each([
  {
    change: 'a new release of the SDK',
    base: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
    head: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.2", "", {}, "sha512-b"], }, }`,
  },
  {
    change: 'the first release of the SDK',
    base: `{ "packages": { "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], }, }`,
    head: `{ "packages": { "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
  },
  {
    change: 'the removal of the SDK',
    base: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
    head: `{ "packages": {}, }`,
  },
  {
    change: 'a second release that one workspace pins',
    base: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
    head: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "spike/@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.4.0", "", {}, "sha512-c"], }, }`,
  },
])('it reports a bump for $change', (row) => {
  expect(isAgentSDKBumped(row.base, row.head)).toBe(true);
});

test.each([
  {
    change: 'a bump of another package',
    base: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.6", "", {}, "sha512-j"], }, }`,
    head: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], }, }`,
  },
  {
    change: 'a lockfile with no SDK on either side',
    base: `{ "packages": { "kysely": ["kysely@0.29.6", "", {}, "sha512-j"], }, }`,
    head: `{ "packages": { "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], }, }`,
  },
  {
    change: 'a release that moves to another workspace key',
    base: `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
    head: `{ "packages": { "spike/@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
  },
  {
    change: 'a package whose name starts with the SDK name',
    base: `{ "packages": { "@anthropic-ai/claude-agent-sdk-extra": ["@anthropic-ai/claude-agent-sdk-extra@1.0.0", "", {}, "sha512-e"], }, }`,
    head: `{ "packages": { "@anthropic-ai/claude-agent-sdk-extra": ["@anthropic-ai/claude-agent-sdk-extra@1.0.1", "", {}, "sha512-f"], }, }`,
  },
])('it reports no bump for $change', (row) => {
  expect(isAgentSDKBumped(row.base, row.head)).toBe(false);
});

test('it throws on a lockfile with no packages object', () => {
  expect(() => isAgentSDKBumped(`{ "lockfileVersion": 1, }`, `{ "packages": {}, }`)).toThrow(
    'bun.lock has no packages object',
  );
});
