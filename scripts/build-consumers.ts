// Builds each consumer with scriptc as a fenced library and writes the module to
// build/consumers/<name>/<sha256 of the module>.wasm. It fails unless scriptc attests the module
// deterministic and the module imports nothing a consumer may not reach.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildConsumerProfile } from './build-consumer-profile.ts';
import { collectForbiddenImports } from './collect-forbidden-imports.ts';
import { consumerSources } from './consumer-sources.ts';

const root = join(import.meta.dir, '..');
const scriptc = join(root, 'node_modules/.bin/scriptc');
const zig = process.env['PEPYS_ZIG_BIN'];
const wasmTools = process.env['PEPYS_WASM_TOOLS_BIN'];

if (zig === undefined || wasmTools === undefined) {
  console.error('set PEPYS_ZIG_BIN and PEPYS_WASM_TOOLS_BIN');
  process.exit(1);
}

const workDirectory = await mkdtemp(join(tmpdir(), 'pepys-consumers-'));

try {
  for (const source of consumerSources) {
    for (const consumer of source.consumers) {
      const entry = join(
        root,
        source.directory,
        'src/consumers',
        `${consumer.name.replaceAll('_', '-')}.ts`,
      );

      const profilePath = join(workDirectory, `${consumer.name}.json`);
      const modulePath = join(workDirectory, `${consumer.name}.wasm`);

      await Bun.write(profilePath, JSON.stringify(buildConsumerProfile({ consumer, entry })));

      const build = Bun.spawn(
        [scriptc, 'build', '--lib', '--profile', profilePath, '-o', modulePath],
        {
          cwd: root,
          env: {
            ...process.env,
            SCRIPTC_TARGET: 'wasm32-wasi',
            PATH: `${dirname(zig)}:${process.env['PATH'] ?? ''}`,
          },
          stdout: 'inherit',
          stderr: 'inherit',
        },
      );

      if ((await build.exited) !== 0) {
        throw new Error(`scriptc failed to build ${consumer.name}`);
      }

      const contract: unknown = await Bun.file(`${modulePath}.contract.json`).json();

      if (typeof contract !== 'object' || contract === null || !('deterministic' in contract)) {
        throw new Error(`the contract of ${consumer.name} has no deterministic field`);
      }

      if (contract.deterministic !== true) {
        throw new Error(`scriptc does not attest ${consumer.name} deterministic`);
      }

      const text = await Bun.$`${wasmTools} print ${modulePath}`.text();

      const forbidden = collectForbiddenImports(text);

      if (forbidden.length > 0) {
        throw new Error(`${consumer.name} imports ${forbidden.join(', ')}`);
      }

      const bytes = await Bun.file(modulePath).bytes();

      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

      const outputPath = join(root, 'build/consumers', consumer.name, `${hash}.wasm`);

      await mkdir(dirname(outputPath), { recursive: true });

      await Bun.write(outputPath, bytes);

      console.log(`${consumer.name}: ${outputPath}`);
    }
  }
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
