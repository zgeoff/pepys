// Fails the release unless the asset in PEPYS_HOST_DIST_DIR is the binary in PEPYS_HOST_BINARY,
// SHA256SUMS lists exactly that asset with its sha256, the asset needs no glibc newer than the
// floor, and the asset starts.
import { join } from 'node:path';
import { collectSumsProblems } from './collect-sums-problems.ts';
import { GLIBC_FLOOR, HOST_ASSET_NAME, SUMS_FILE_NAME } from './constants.ts';
import { findGlibcAboveFloor } from './find-glibc-above-floor.ts';
import { readSHA256 } from './read-sha256.ts';

const binary = process.env['PEPYS_HOST_BINARY'];
const distDirectory = process.env['PEPYS_HOST_DIST_DIR'];

if (binary === undefined || binary === '' || distDirectory === undefined || distDirectory === '') {
  console.error('needs PEPYS_HOST_BINARY and PEPYS_HOST_DIST_DIR set');
  process.exit(1);
}

const asset = join(distDirectory, HOST_ASSET_NAME);
const sumsFile = Bun.file(join(distDirectory, SUMS_FILE_NAME));

const hasAsset = await Bun.file(asset).exists();
const hasSums = await sumsFile.exists();

const sumsText = hasSums ? await sumsFile.text() : null;
const assetSHA256 = hasAsset ? await readSHA256(asset) : null;
const problems = collectSumsProblems(sumsText, assetSHA256);

if (hasAsset) {
  const binarySHA256 = await readSHA256(binary);

  if (assetSHA256 !== binarySHA256) {
    problems.push(`${HOST_ASSET_NAME} is not the binary at ${binary}`);
  }

  const symbolTable = await runCapture(['objdump', '-T', asset]);

  const newerGlibc = findGlibcAboveFloor(symbolTable, GLIBC_FLOOR);

  if (newerGlibc !== null) {
    problems.push(`${HOST_ASSET_NAME} needs glibc ${newerGlibc}, newer than ${GLIBC_FLOOR}`);
  }

  const helpExitCode = await Bun.spawn([asset, '--help'], { stdout: 'ignore', stderr: 'inherit' })
    .exited;

  if (helpExitCode !== 0) {
    problems.push(`${HOST_ASSET_NAME} --help exited with ${helpExitCode}`);
  }
}

for (const problem of problems) {
  console.error(problem);
}

const exitCode = problems.length === 0 ? 0 : 1;

process.exit(exitCode);

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
