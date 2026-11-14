import { WringerError } from '@wringer/core';
import type { MCPClient } from '@wringer/mcp';

// The doctor's check that the target's service client signs in: the mcp driver trades its ID and
// secret for an access token, and lists the tools with it.
export async function checkMCPSignIn(mcp: MCPClient): Promise<{ server: string; tools: number }> {
  const answer = await mcp.tools().catch((error: unknown) => {
    if (error instanceof WringerError) {
      throw new WringerError('check-failed', {
        message: `the service client did not sign in: ${error.message}`,
        hint: error.hint ?? 'Read the message, fix its cause, then run `bun verify doctor` again.',
      });
    }

    throw error;
  });

  return { server: answer.server, tools: answer.tools.length };
}
