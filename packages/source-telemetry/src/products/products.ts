import { claudeCodeProduct } from './claude-code/claude-code-product.ts';
import { codexProduct } from './codex/codex-product.ts';

// The one list of products. A third product is one more entry here, and one more case in each
// consumer, which does not compile until the case is there.
export const products = [claudeCodeProduct, codexProduct] as const;

export type ProductName = (typeof products)[number]['name'];
