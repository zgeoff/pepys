export function toSnakeCase(name: string): string {
  return name
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, '$<lower>_$<upper>')
    .replaceAll(/[^A-Za-z0-9]+/gu, '_')
    .toLowerCase();
}
