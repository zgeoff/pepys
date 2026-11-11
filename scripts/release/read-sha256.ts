// Reads a file in chunks, so a binary of tens of megabytes never sits in memory whole.
export async function readSHA256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');

  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }

  return hasher.digest('hex');
}
