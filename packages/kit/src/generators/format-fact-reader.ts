import type { z } from 'zod';
import type { ConsumerInput } from '../consumers/types.ts';
import type { FactFamily } from '../sources/types.ts';
import { buildPayloadShape } from './build-payload-shape.ts';
import { formatLiteral } from './format-literal.ts';
import { formatPayloadShape } from './format-payload-shape.ts';
import type { FormattedShape } from './format-payload-shape.ts';
import { toEntityIDTypeName } from './to-entity-id-type-name.ts';
import { toPascalCase } from './to-pascal-case.ts';

interface FactReaderParameters {
  consumerName: string;
  input: ConsumerInput;

  // the families on the consumer's streams
  families: readonly FactFamily[];
}

// The fact union of the consumer's streams, its decoder, and the read: `readScopeFacts` in scope
// mode, `parse<Consumer>Fact` in fact mode. A fact whose type no family declares, or whose payload
// does not decode, reads as no fact.
export function formatFactReader(parameters: FactReaderParameters): string[] {
  const fact = `${parameters.consumerName}Fact`;
  const groups = collectPayloadGroups(parameters.families);

  const members = groups.map((group) => ({
    types: group.types,
    payload: formatPayloadShape(
      buildPayloadShape(group.schema),
      `${toPascalCase(pickPayloadName(group.types))}Payload`,
    ),
  }));

  return [
    formatFactID(),
    ...members.flatMap((member) => member.payload.interfaces),
    formatFactUnion(fact, members),
    ...formatRead(fact, parameters.input),
    formatFactDecoder(fact, members),
    ...members.flatMap((member) => member.payload.decoders),
  ];
}

interface PayloadGroup {
  schema: z.ZodType;
  types: string[];
}

// Fact types that share one schema share one payload type and one decoder.
function collectPayloadGroups(families: readonly FactFamily[]): PayloadGroup[] {
  const groups = new Map<z.ZodType, string[]>();

  for (const family of families) {
    for (const [type, schema] of Object.entries(family.types)) {
      groups.set(schema, [...(groups.get(schema) ?? []), type]);
    }
  }

  return [...groups].map(([schema, types]) => ({ schema, types }));
}

// Types that share a schema share the dotted prefix of their names, such as `github.pull_request`
// for every action of a pull request delivery.
function pickPayloadName(types: readonly string[]): string {
  const [first = [], ...rest] = types.map((type) => type.split('.'));
  const end = first.findIndex((part, index) => rest.some((other) => other[index] !== part));
  const shared = end === -1 ? first : first.slice(0, end);

  return shared.length > 0 ? shared.join('.') : (types[0] ?? '');
}

// scriptc refuses a type-fest import, so the glue brands a fact ID with a symbol of its own.
function formatFactID(): string {
  return [
    'declare const factTag: unique symbol;',
    '',
    "export type FactID = string & { readonly [factTag]: 'FactID' };",
  ].join('\n');
}

interface FactMember {
  types: readonly string[];
  payload: FormattedShape;
}

function formatFactUnion(fact: string, members: readonly FactMember[]): string {
  if (members.length === 0) {
    return `export type ${fact} = never;`;
  }

  const lines = members.map(
    (member) =>
      `  | { id: FactID; type: ${formatTypeUnion(member.types)}; entity: EntityID; at: string; payload: ${member.payload.type} }`,
  );

  return [`export type ${fact} =`, ...lines].join('\n').concat(';');
}

function formatTypeUnion(types: readonly string[]): string {
  return types.map((type) => formatLiteral(type)).join(' | ');
}

function formatRead(fact: string, input: ConsumerInput): string[] {
  if (input.mode === 'fact') {
    return [
      [
        `export function parse${fact}(factJSON: string): ${fact} | undefined {`,
        '  const parsed: unknown = JSON.parse(factJSON);',
        '',
        `  return decode${fact}(parsed);`,
        '}',
      ].join('\n'),
    ];
  }

  const scope = toEntityIDTypeName(input.scopeKind);

  return [
    [
      `declare function readScopeFactsLength(scope: ${scope}): number;`,
      `declare function readScopeFactsInto(scope: ${scope}, facts: Uint8Array): void;`,
    ].join('\n'),
    [
      "// every fact of the scope on the consumer's streams, one per fact ID, in the host's order",
      `export function readScopeFacts(scope: ${scope}): ${fact}[] {`,
      '  const buffer = new Uint8Array(readScopeFactsLength(scope));',
      '',
      '  readScopeFactsInto(scope, buffer);',
      '',
      '  const parsed: unknown = JSON.parse(new TextDecoder().decode(buffer));',
      `  const facts: ${fact}[] = [];`,
      '',
      '  if (!Array.isArray(parsed)) {',
      '    return facts;',
      '  }',
      '',
      '  for (let index = 0; index < parsed.length; index += 1) {',
      `    const decoded = decode${fact}(parsed[index]);`,
      '',
      '    if (decoded !== undefined) {',
      '      facts.push(decoded);',
      '    }',
      '  }',
      '',
      '  return facts;',
      '}',
    ].join('\n'),
  ];
}

function formatFactDecoder(fact: string, members: readonly FactMember[]): string {
  const parameter = members.length === 0 ? '_value' : 'value';

  const branches = members.flatMap((member) => [
    `  if (${member.types.map((type) => `type === ${formatLiteral(type)}`).join(' || ')}) {`,
    ...formatPayloadDecode(member.payload),
    '    return { id, type, entity, at, payload: decoded };',
    '  }',
    '',
  ]);

  const body =
    members.length === 0
      ? []
      : [
          "  if (typeof value !== 'object' || value === null || Array.isArray(value)) {",
          '    return undefined;',
          '  }',
          '',
          "  const id = 'id' in value ? value.id : undefined;",
          "  const type = 'type' in value ? value.type : undefined;",
          "  const entity = 'entity' in value ? value.entity : undefined;",
          "  const at = 'at' in value ? value.at : undefined;",
          "  const payload = 'payload' in value ? value.payload : undefined;",
          '',
          "  if (typeof id !== 'string' || typeof entity !== 'string' || typeof at !== 'string') {",
          '    return undefined;',
          '  }',
          '',
          '  if (!isFactID(id) || !isFactEntityID(entity)) {',
          '    return undefined;',
          '  }',
          '',
          ...branches,
        ];

  const decoder = [
    `function decode${fact}(${parameter}: unknown): ${fact} | undefined {`,
    ...body,
    '  return undefined;',
    '}',
  ].join('\n');

  return members.length === 0 ? decoder : [decoder, formatFactIDGuards()].join('\n\n');
}

function formatPayloadDecode(payload: FormattedShape): string[] {
  if (!payload.canFail) {
    return ['    const decoded = payload;', ''];
  }

  return [
    `    const decoded = ${payload.decode('payload')};`,
    '',
    '    if (decoded === undefined) {',
    '      return undefined;',
    '    }',
    '',
  ];
}

// The host checked both IDs when the fact came in, so the glue only brands them.
function formatFactIDGuards(): string {
  return [
    'function isFactID(text: string): text is FactID {',
    '  return text.length > 0;',
    '}',
    '',
    'function isFactEntityID(text: string): text is EntityID {',
    '  return text.length > 0;',
    '}',
  ].join('\n');
}
