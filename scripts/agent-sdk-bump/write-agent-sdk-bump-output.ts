import { isAgentSDKBumped } from './is-agent-sdk-bumped.ts';

export interface AgentSDKBumpDependencies {
  readonly readBaseLockfile: () => Promise<string>;
  readonly readHeadLockfile: () => Promise<string>;
  readonly writeOutput: (line: string) => Promise<void>;
}

export async function writeAgentSDKBumpOutput(
  dependencies: Readonly<AgentSDKBumpDependencies>,
): Promise<void> {
  const baseLockfile = await dependencies.readBaseLockfile();
  const headLockfile = await dependencies.readHeadLockfile();

  await dependencies.writeOutput(`bumped=${isAgentSDKBumped(baseLockfile, headLockfile)}\n`);
}
