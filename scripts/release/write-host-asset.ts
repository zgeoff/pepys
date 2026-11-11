// Copies the built host binary in PEPYS_HOST_BINARY into PEPYS_HOST_DIST_DIR under its asset name,
// and writes SHA256SUMS for it beside it.
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST_ASSET_NAME, SUMS_FILE_NAME } from './constants.ts';
import { formatSHA256Sums } from './format-sha256-sums.ts';
import { readSHA256 } from './read-sha256.ts';

const binary = process.env['PEPYS_HOST_BINARY'];
const distDirectory = process.env['PEPYS_HOST_DIST_DIR'];

if (binary === undefined || binary === '' || distDirectory === undefined || distDirectory === '') {
  console.error('needs PEPYS_HOST_BINARY and PEPYS_HOST_DIST_DIR set');
  process.exit(1);
}

const asset = join(distDirectory, HOST_ASSET_NAME);

await mkdir(distDirectory, { recursive: true });
await copyFile(binary, asset);
await chmod(asset, 0o755);

const sums = formatSHA256Sums([{ name: HOST_ASSET_NAME, sha256: await readSHA256(asset) }]);

await Bun.write(join(distDirectory, SUMS_FILE_NAME), sums);

process.stdout.write(sums);
