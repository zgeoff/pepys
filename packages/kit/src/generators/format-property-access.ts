import { formatLiteral } from './format-literal.ts';
import { isIdentifier } from './is-identifier.ts';

export function formatPropertyAccess(object: string, name: string): string {
  return isIdentifier(name) ? `${object}.${name}` : `${object}[${formatLiteral(name)}]`;
}
