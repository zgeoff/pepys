export interface FileSum {
  name: string;
  sha256: string;
}

// The text form of `sha256sum`: the hex, two spaces, then the bare file name, so `sha256sum -c`
// passes in whatever folder a deploy downloads the release into.
export function formatSHA256Sums(sums: readonly FileSum[]): string {
  return sums.map((sum) => `${sum.sha256}  ${sum.name}\n`).join('');
}
