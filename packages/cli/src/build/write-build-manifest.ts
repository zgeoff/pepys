import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result } from '@pepys/kit';
import type { ConsumerBuildManifest } from '@pepys/schema';
import { consumerBuildManifestSchema } from '@pepys/schema';

// Writes `<out>/consumers.json` and returns its path, or the schema's issues and writes nothing. The
// file passes the strict schema first, so the build never writes a file that the host refuses, such
// as one with a table named after a table of the host.
export async function writeBuildManifest(
  out: string,
  manifest: ConsumerBuildManifest,
): Promise<Result<string, readonly string[]>> {
  const parsed = consumerBuildManifestSchema.safeParse(manifest);

  if (!parsed.success) {
    return {
      ok: false,
      failure: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const path = join(out, 'consumers.json');

  await mkdir(out, { recursive: true });

  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);

  return { ok: true, value: path };
}
