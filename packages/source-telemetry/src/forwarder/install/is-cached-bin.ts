// A bin file under a `bunx` cache folder can disappear, so a unit must never point at one.
export function isCachedBin(binPath: string): boolean {
  return binPath.split('/').some((part) => part.startsWith('bunx-'));
}
