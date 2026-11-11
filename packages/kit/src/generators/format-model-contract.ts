// scriptc attests a library whose entry exports a model type, a message union tagged by `kind`,
// `init` and `update`. It takes the types through a re-export but not the functions, so the entry
// declares `init` and `update` and calls these two.
export function formatModelContract(consumerName: string): string {
  const model = `${consumerName}Model`;
  const message = `${consumerName}Message`;

  return [
    `export interface ${model} {`,
    '  input: string;',
    '}',
    '',
    `export type ${message} = { kind: 'apply'; input: string } | { kind: 'reset' };`,
    '',
    `export function init${model}(): ${model} {`,
    "  return { input: '' };",
    '}',
    '',
    `export function update${model}(model: ${model}, message: ${message}): ${model} {`,
    `  return message.kind === 'reset' ? init${model}() : { ...model, input: message.input };`,
    '}',
  ].join('\n');
}
