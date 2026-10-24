const escapePattern = /\\(?:u\{(?<codePoint>[0-9a-fA-F]+)\}|(?<character>.))/gsu;

const escapedCharacters = new Map([
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['"', '"'],
  ["'", "'"],
  ['\\', '\\'],
]);

export function parseWaveString(text: string): string | undefined {
  const trimmed = text.trim();

  if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2) {
    return undefined;
  }

  return trimmed.slice(1, -1).replaceAll(escapePattern, (escape, ...rest: unknown[]) => {
    const groups = rest.at(-1);

    if (typeof groups !== 'object' || groups === null) {
      return escape;
    }

    const codePoint: unknown = Reflect.get(groups, 'codePoint');
    const character: unknown = Reflect.get(groups, 'character');

    if (typeof codePoint === 'string') {
      return String.fromCodePoint(Number.parseInt(codePoint, 16));
    }

    return typeof character === 'string' ? (escapedCharacters.get(character) ?? escape) : escape;
  });
}
