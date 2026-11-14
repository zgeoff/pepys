import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localMCPClient } from '../constants.ts';

// Writes the API's service-token file into `directory`: the run's one service client, with the
// digest of its secret and the read scope, for the `/mcp` resource at `apiURL`. The file holds no
// secret, and only the run's user reads it.
export async function writeServiceTokenFile(
  directory: string,
  apiURL: string,
  digest: string,
): Promise<string> {
  const path = join(directory, 'service-tokens.json');

  const file = {
    resource: `${apiURL}/mcp`,
    clients: { [localMCPClient.name]: { scopes: ['read'], secretDigests: [digest] } },
  };

  // Bun.write ignores its mode option for a string, which leaves the file readable by every user
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });

  return path;
}
