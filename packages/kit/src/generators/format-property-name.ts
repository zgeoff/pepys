import { formatLiteral } from './format-literal.ts';
import { isIdentifier } from './is-identifier.ts';

export function formatPropertyName(name: string): string {
  return isIdentifier(name) ? name : formatLiteral(name);
}
