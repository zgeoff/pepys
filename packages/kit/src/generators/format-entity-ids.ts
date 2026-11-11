import type { EntityKind } from '../link-types/types.ts';
import { formatLiteral } from './format-literal.ts';
import { toEntityIDTypeName } from './to-entity-id-type-name.ts';

// The glue brands IDs with its own symbols: scriptc refuses a type-fest import, and a brand whose
// tag is `string` and not a literal. So a kinded ID is an EntityID with a second, literal tag.
export function formatEntityIDs(kinds: readonly EntityKind[]): string[] {
  return [
    [
      'declare const idTag: unique symbol;',
      'declare const kindTag: unique symbol;',
      '',
      "export type EntityID = string & { readonly [idTag]: 'EntityID' };",
      '',
      'type KindedID<Kind extends string> = EntityID & { readonly [kindTag]: Kind };',
    ].join('\n'),
    ...kinds.map((kind) => formatKindedID(kind)),
  ];
}

function formatKindedID(kind: EntityKind): string {
  const name = toEntityIDTypeName(kind);
  const prefix = formatLiteral(`${kind}:`);

  return [
    `export type ${name} = KindedID<${formatLiteral(kind)}>;`,
    '',
    `export function to${name}(id: string): ${name} {`,
    `  const text = ${prefix} + id;`,
    '',
    `  if (!is${name}(text)) {`,
    `    throw new Error(${formatLiteral(`an ID of the kind ${kind} is never empty`)});`,
    '  }',
    '',
    '  return text;',
    '}',
    '',
    `export function parse${name}(text: string): ${name} | undefined {`,
    `  return is${name}(text) ? text : undefined;`,
    '}',
    '',
    `function is${name}(text: string): text is ${name} {`,
    `  return text.length > ${prefix}.length && text.startsWith(${prefix});`,
    '}',
  ].join('\n');
}
