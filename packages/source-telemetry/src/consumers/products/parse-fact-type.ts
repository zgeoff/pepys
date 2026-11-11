import type { ProductName } from './types.ts';

const productNames: readonly ProductName[] = ['claude_code', 'codex'];

// `telemetry.<product>.<event>`, with `unlisted` as the event of a record the product does not list
export function parseFactType(type: string): { product: ProductName; event: string } | undefined {
  const parts = type.split('.');
  const [source, productPart, event] = parts;
  const product = productNames.find((name) => name === productPart);

  if (
    parts.length !== 3 ||
    source !== 'telemetry' ||
    product === undefined ||
    event === undefined
  ) {
    return undefined;
  }

  return { product, event };
}
