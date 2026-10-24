// Writes the files that the consumer declarations generate, or with --check compares them with the
// committed files and exits 1 listing each that differs.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildGeneratedFiles } from './build-generated-files.ts';
import type { GeneratedFile } from './build-generated-files.ts';

const root = join(import.meta.dir, '..');
const generated = buildGeneratedFiles();

if (!generated.ok) {
  console.error(`the consumer declarations are invalid:\n${Bun.inspect(generated.failures)}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const stale = await readStaleFiles(generated.files);

  if (stale.length > 0) {
    console.error(`generated files differ from the declarations; run \`bun run schema:generate\`:`);
    console.error(stale.map((path) => `  ${path}`).join('\n'));
    process.exit(1);
  }
} else {
  for (const file of generated.files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });

    await Bun.write(join(root, file.path), file.content);
  }
}

async function readStaleFiles(files: readonly GeneratedFile[]): Promise<string[]> {
  const results = await Promise.all(
    files.map(async (file) => {
      const handle = Bun.file(join(root, file.path));

      const exists = await handle.exists();

      const committed = exists ? await handle.text() : undefined;

      return { path: file.path, isStale: committed !== file.content };
    }),
  );

  return results.filter((result) => result.isStale).map((result) => result.path);
}
