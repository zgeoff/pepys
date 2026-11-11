// Collects the name of each listed consumer whose current version in the store is not the version
// that `consumers.json` lists. A null current version means the consumer has none yet.
export function collectLaggingConsumers(
  listed: readonly { name: string; version: string }[],
  currentVersions: ReadonlyMap<string, string | null>,
): string[] {
  return listed
    .filter((consumer) => currentVersions.get(consumer.name) !== consumer.version)
    .map((consumer) => consumer.name);
}
