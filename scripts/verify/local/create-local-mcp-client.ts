import { mintServiceSecret } from '@zgeoff/mcp-auth';
import { localMCPClient } from '../constants.ts';

// Mints the run's service client and returns its secret's digest, for the app's service-token file.
// The supervisor calls `launch`, and its mcp driver reads the secret from this process's
// environment, so the secret goes there and never reaches the app.
export function createLocalMCPClient(): string {
  const minted = mintServiceSecret();

  process.env[localMCPClient.secretEnv] = minted.secret;

  return minted.digest;
}
