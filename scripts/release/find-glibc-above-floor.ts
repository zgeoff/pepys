const GLIBC_VERSION = /GLIBC_(?<version>\d+(?:\.\d+)+)/gu;

// Finds the newest glibc symbol version in `objdump -T` output that is newer than the floor, or
// null when the binary needs nothing newer than the floor.
export function findGlibcAboveFloor(objdumpText: string, floor: string): string | null {
  let newest: string | null = null;

  for (const found of objdumpText.matchAll(GLIBC_VERSION)) {
    const version = found.groups?.['version'];

    if (version === undefined || compareVersions(version, floor) <= 0) {
      continue;
    }

    if (newest === null || compareVersions(version, newest) > 0) {
      newest = version;
    }
  }

  return newest;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
