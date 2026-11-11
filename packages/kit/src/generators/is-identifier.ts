const identifierPattern = /^[A-Za-z_$][\w$]*$/u;

export function isIdentifier(name: string): boolean {
  return identifierPattern.test(name);
}
