import { match } from 'ts-pattern';
import type { PayloadField, PayloadShape } from './build-payload-shape.ts';
import { formatLiteral } from './format-literal.ts';
import { formatPropertyAccess } from './format-property-access.ts';
import { formatPropertyName } from './format-property-name.ts';
import { toPascalCase } from './to-pascal-case.ts';

// The glue's type for one payload shape, the expression that decodes an `unknown` identifier into
// it (or `undefined` when the value does not fit), and the interfaces and decoders it needs.
export interface FormattedShape {
  type: string;
  decode: (identifier: string) => string;
  canFail: boolean;
  interfaces: readonly string[];
  decoders: readonly string[];
}

export function formatPayloadShape(shape: PayloadShape, name: string): FormattedShape {
  return match(shape)
    .with({ kind: 'string' }, { kind: 'number' }, { kind: 'boolean' }, (primitive) => ({
      type: primitive.kind,
      decode: (identifier: string) =>
        `typeof ${identifier} === '${primitive.kind}' ? ${identifier} : undefined`,
      canFail: true,
      interfaces: [],
      decoders: [],
    }))
    .with({ kind: 'literal' }, (literal) => {
      const values = literal.values.map((value) => formatLiteral(value));

      return {
        type: values.join(' | '),
        decode: (identifier: string) =>
          `${values.map((value) => `${identifier} === ${value}`).join(' || ')} ? ${identifier} : undefined`,
        canFail: true,
        interfaces: [],
        decoders: [],
      };
    })
    .with({ kind: 'nullable' }, (nullable) => {
      const inner = formatPayloadShape(nullable.inner, name);

      return {
        type: `${inner.type} | null`,
        decode: (identifier: string) =>
          `${identifier} === null ? null : ${inner.decode(identifier)}`,
        canFail: inner.canFail,
        interfaces: inner.interfaces,
        decoders: inner.decoders,
      };
    })
    .with({ kind: 'object' }, (object) => formatObjectShape(object.fields, name))
    .with({ kind: 'array' }, (array) => formatArrayShape(array.element, name))
    .with({ kind: 'unknown' }, () => ({
      type: 'unknown',
      decode: (identifier: string) => identifier,
      canFail: false,
      interfaces: [],
      decoders: [],
    }))
    .exhaustive();
}

function formatObjectShape(fields: readonly PayloadField[], name: string): FormattedShape {
  const formatted = fields.map((field) => ({
    field,
    shape: formatPayloadShape(field.shape, `${name}${toPascalCase(field.name)}`),
  }));

  const members = formatted.map(
    (entry) =>
      `  ${formatPropertyName(entry.field.name)}${entry.field.isOptional ? '?' : ''}: ${entry.shape.type};`,
  );

  const reads = formatted.flatMap((entry, index) =>
    formatFieldRead(entry.field, entry.shape, index),
  );

  const properties = formatted.map((entry, index) =>
    entry.field.isOptional
      ? `    ...(field${index} === undefined ? {} : { ${formatPropertyName(entry.field.name)}: field${index} }),`
      : `    ${formatPropertyName(entry.field.name)}: field${index},`,
  );

  const decoder = [
    `function decode${name}(value: unknown): ${name} | undefined {`,
    "  if (typeof value !== 'object' || value === null || Array.isArray(value)) {",
    '    return undefined;',
    '  }',
    '',
    ...reads,
    '  return {',
    ...properties,
    '  };',
    '}',
  ].join('\n');

  return {
    type: name,
    decode: (identifier: string) => `decode${name}(${identifier})`,
    canFail: true,
    interfaces: [
      [`export interface ${name} {`, ...members, '}'].join('\n'),
      ...formatted.flatMap((entry) => entry.shape.interfaces),
    ],
    decoders: [decoder, ...formatted.flatMap((entry) => entry.shape.decoders)],
  };
}

function formatFieldRead(field: PayloadField, shape: FormattedShape, index: number): string[] {
  const read = `${formatLiteral(field.name)} in value ? ${formatPropertyAccess('value', field.name)} : undefined`;

  if (!shape.canFail) {
    return [`  const field${index} = ${read};`, ''];
  }

  if (field.isOptional) {
    return [
      `  const raw${index} = ${read};`,
      `  const field${index} = raw${index} === undefined ? undefined : ${shape.decode(`raw${index}`)};`,
      '',
      `  if (raw${index} !== undefined && field${index} === undefined) {`,
      '    return undefined;',
      '  }',
      '',
    ];
  }

  return [
    `  const raw${index} = ${read};`,
    `  const field${index} = ${shape.decode(`raw${index}`)};`,
    '',
    `  if (field${index} === undefined) {`,
    '    return undefined;',
    '  }',
    '',
  ];
}

// An index loop: `for...of` over a parsed list makes scriptc link its dynamic invoke object.
function formatArrayShape(element: PayloadShape, name: string): FormattedShape {
  const item = formatPayloadShape(element, `${name}Item`);
  const type = item.type.includes(' | ') ? `(${item.type})[]` : `${item.type}[]`;

  const push = item.canFail
    ? [
        `    const item = ${item.decode('element')};`,
        '',
        '    if (item === undefined) {',
        '      return undefined;',
        '    }',
        '',
        '    items.push(item);',
      ]
    : ['    items.push(element);'];

  const decoder = [
    `function decode${name}(value: unknown): ${type} | undefined {`,
    '  if (!Array.isArray(value)) {',
    '    return undefined;',
    '  }',
    '',
    `  const items: ${type} = [];`,
    '',
    '  for (let index = 0; index < value.length; index += 1) {',
    '    const element: unknown = value[index];',
    ...push,
    '  }',
    '',
    '  return items;',
    '}',
  ].join('\n');

  return {
    type,
    decode: (identifier: string) => `decode${name}(${identifier})`,
    canFail: true,
    interfaces: item.interfaces,
    decoders: [decoder, ...item.decoders],
  };
}
