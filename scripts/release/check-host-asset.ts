// Fails the release unless the asset in PEPYS_HOST_DIST_DIR is the binary in PEPYS_HOST_BINARY,
// SHA256SUMS lists exactly that asset with its sha256, the asset needs no glibc newer than the
// floor, and the asset starts.
import { join } from 'node:path';
import { collectHostAssetProblems } from './collect-host-asset-problems.ts';
import type { HostAssetFacts } from './collect-host-asset-problems.ts';
import { HOST_ASSET_NAME, SUMS_FILE_NAME } from './constants.ts';
import { readSHA256 } from './read-sha256.ts';

const binary = process.env['PEPYS_HOST_BINARY'];
const distDirectory = process.env['PEPYS_HOST_DIST_DIR'];

if (binary === undefined || binary === '' || distDirectory === undefined || distDirectory === '') {
  console.error('needs PEPYS_HOST_BINARY and PEPYS_HOST_DIST_DIR set');
  process.exit(1);
}

const sumsFile = Bun.file(join(distDirectory, SUMS_FILE_NAME));

const hasSums = await sumsFile.exists();

const problems = collectHostAssetProblems({
  sumsText: hasSums ? await sumsFile.text() : null,
  asset: await readHostAssetFacts(join(distDirectory, HOST_ASSET_NAME), binary),
});

for (const problem of problems) {
  console.error(problem);
}

const exitCode = problems.length === 0 ? 0 : 1;

process.exit(exitCode);

// what the check needs to know of the asset, or null when there is no asset to read
async function readHostAssetFacts(
  asset: string,
  builtBinary: string,
): Promise<HostAssetFacts | null> {
  const hasAsset = await Bun.file(asset).exists();

  if (!hasAsset) {
    return null;
  }

  const sha256 = await readSHA256(asset);
  const binarySHA256 = await readSHA256(builtBinary);
  const symbolTable = await runCapture(['objdump', '-T', asset]);

  const helpExitCode = await Bun.spawn([asset, '--help'], { stdout: 'ignore', stderr: 'inherit' })
    .exited;

  return { sha256, binarySHA256, binary: builtBinary, symbolTable, helpExitCode };
}

async function runCapture(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'inherit' });

  const [output, commandExitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);

  if (commandExitCode !== 0) {
    console.error(`${command.join(' ')} exited with ${commandExitCode}`);
    process.exit(1);
  }

  return output;
}
