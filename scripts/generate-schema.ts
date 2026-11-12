// Writes the files that the consumer declarations generate, or with --check compares them with the
// committed files and exits 1 listing each that differs.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readOptionalText } from '@zgeoff/std';
import { buildGeneratedFiles } from './build-generated-files.ts';
import type { GeneratedFile } from './build-generated-files.ts';
import { collectStaleFiles } from './collect-stale-files.ts';

const root = join(import.meta.dir, '..');
const generated = buildGeneratedFiles();

if (!generated.ok) {
  console.error(`the consumer declarations are invalid:\n${Bun.inspect(generated.failures)}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const committed = await readCommittedFiles(generated.files);

  const stale = collectStaleFiles(generated.files, committed);

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

async function readCommittedFiles(files: readonly GeneratedFile[]): Promise<Map<string, string>> {
  const texts = await Promise.all(
    files.map(async (file) => [file.path, await readOptionalText(join(root, file.path))] as const),
  );

  return new Map(
    texts.flatMap(([path, text]): [string, string][] => (text === undefined ? [] : [[path, text]])),
  );
}
