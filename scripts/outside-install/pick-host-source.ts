import { HOST_ASSET_NAME, RELEASES_URL, SUMS_FILE_NAME } from '../release/constants.ts';

export type HostSource =
  | { kind: 'local'; binary: string }
  | { kind: 'release'; tag: string; assetURL: string; sumsURL: string }
  | { kind: 'conflict' };

export interface HostSourceInput {
  // PEPYS_OUTSIDE_HOST: the path of a host binary
  binary: string | undefined;

  // PEPYS_OUTSIDE_HOST_TAG: a release tag whose host asset to download
  tag: string | undefined;

  // the host that `cargo build --bin pepys` writes in the repo
  localBuild: string;
}

// Picks where the deployment check takes its host binary from: a release tag's asset, a given path,
// or the repo's own debug build. An empty variable counts as unset, and both set is a conflict.
export function pickHostSource(input: HostSourceInput): HostSource {
  const binary = input.binary === '' ? undefined : input.binary;
  const tag = input.tag === '' ? undefined : input.tag;

  if (binary !== undefined && tag !== undefined) {
    return { kind: 'conflict' };
  }

  if (tag !== undefined) {
    return {
      kind: 'release',
      tag,
      assetURL: `${RELEASES_URL}/${tag}/${HOST_ASSET_NAME}`,
      sumsURL: `${RELEASES_URL}/${tag}/${SUMS_FILE_NAME}`,
    };
  }

  return { kind: 'local', binary: binary ?? input.localBuild };
}
