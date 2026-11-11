import { HOST_ASSET_NAME, SUMS_FILE_NAME } from './constants.ts';

const SUMS_LINE = /^(?<sha256>[0-9a-f]{64}) [ *](?<name>.+)$/u;

// Collects each way the sums file and the asset beside it disagree. A null stands for a file that
// is missing. An empty list means a deploy's `sha256sum -c` passes on exactly the host asset.
export function collectSumsProblems(sumsText: string | null, assetSHA256: string | null): string[] {
  if (sumsText === null) {
    const assetProblems = assetSHA256 === null ? [`${HOST_ASSET_NAME} is missing`] : [];

    return [`${SUMS_FILE_NAME} is missing`, ...assetProblems];
  }

  const problems: string[] = [];
  const names: string[] = [];
  let listedSHA256: string | undefined;

  for (const line of sumsText.split('\n').filter((text) => text !== '')) {
    const groups = SUMS_LINE.exec(line)?.groups;

    if (groups?.['sha256'] === undefined || groups['name'] === undefined) {
      problems.push(`${SUMS_FILE_NAME} has a line that is not in the sha256sum format: ${line}`);
      continue;
    }

    names.push(groups['name']);

    if (groups['name'] === HOST_ASSET_NAME) {
      listedSHA256 = groups['sha256'];
    }
  }

  if (names.length !== 1 || names[0] !== HOST_ASSET_NAME) {
    problems.push(
      `${SUMS_FILE_NAME} lists [${names.join(', ')}], and needs exactly ${HOST_ASSET_NAME}`,
    );
  }

  if (assetSHA256 === null) {
    problems.push(`${HOST_ASSET_NAME} is missing`);
  } else if (listedSHA256 !== undefined && listedSHA256 !== assetSHA256) {
    problems.push(
      `${SUMS_FILE_NAME} gives ${HOST_ASSET_NAME} the sha256 ${listedSHA256}, and the file has ${assetSHA256}`,
    );
  }

  return problems;
}
