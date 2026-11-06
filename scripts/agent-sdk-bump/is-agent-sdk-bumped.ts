import { isRecord } from '../dependency-gates/is-record.ts';

export function isAgentSDKBumped(baseLockfile: string, headLockfile: string): boolean {
  return collectAgentSDKVersions(baseLockfile) !== collectAgentSDKVersions(headLockfile);
}

const agentSDKPrefix = '@anthropic-ai/claude-agent-sdk@';

// bun.lock keys a release that one workspace pins on its own under that workspace's path, so the
// version comes from each entry's id, never from its key.
function collectAgentSDKVersions(lockfile: string): string {
  const parsed: unknown = Bun.JSONC.parse(lockfile);
  const packages = isRecord(parsed) ? parsed['packages'] : undefined;

  if (!isRecord(packages)) {
    throw new TypeError('bun.lock has no packages object');
  }

  const versions = Object.values(packages).flatMap((entry) => {
    const id: unknown = isList(entry) ? entry[0] : undefined;

    return typeof id === 'string' && id.startsWith(agentSDKPrefix)
      ? [id.slice(agentSDKPrefix.length)]
      : [];
  });

  return [...new Set(versions)].toSorted().join(' ');
}

// Array.isArray narrows to any[], which turns the type check off for each value.
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
