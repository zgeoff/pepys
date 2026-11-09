export function toPascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== '')
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join('');
}
