import { collectSumsProblems } from './collect-sums-problems.ts';
import { GLIBC_FLOOR, HOST_ASSET_NAME } from './constants.ts';
import { findGlibcAboveFloor } from './find-glibc-above-floor.ts';

// what the check reads from an asset that exists
export interface HostAssetFacts {
  sha256: string;

  // the sha256 of the built binary that the asset should be a copy of
  binarySHA256: string;

  binary: string;

  // the output of `objdump -T` on the asset
  symbolTable: string;

  // the exit code of `<asset> --help`
  helpExitCode: number;
}

export interface HostAssetInput {
  // the text of SHA256SUMS, or null when the file is missing
  sumsText: string | null;

  // null when the asset is missing
  asset: HostAssetFacts | null;
}

export function collectHostAssetProblems(input: HostAssetInput): string[] {
  const asset = input.asset;
  const sumsProblems = collectSumsProblems(input.sumsText, asset?.sha256 ?? null);

  if (asset === null) {
    return sumsProblems;
  }

  const newerGlibc = findGlibcAboveFloor(asset.symbolTable, GLIBC_FLOOR);

  return [
    ...sumsProblems,
    ...(asset.sha256 === asset.binarySHA256
      ? []
      : [`${HOST_ASSET_NAME} is not the binary at ${asset.binary}`]),
    ...(newerGlibc === null
      ? []
      : [`${HOST_ASSET_NAME} needs glibc ${newerGlibc}, newer than ${GLIBC_FLOOR}`]),
    ...(asset.helpExitCode === 0
      ? []
      : [`${HOST_ASSET_NAME} --help exited with ${asset.helpExitCode}`]),
  ];
}
