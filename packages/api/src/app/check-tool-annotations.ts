import { getMcpToolMeta } from '@orpc/mcp';
import type { AnyProcedure } from '@orpc/server';
import { readOnlyToolAnnotations } from '@pepys/contract';

// A client that sees no annotations on a tool treats it as one that writes, deletes and reaches
// outside, and asks before each call. Every pepys tool reads its own data, so the router refuses a
// procedure that leaves any of the four hints out or sets one differently.
export function checkToolAnnotations(router: Record<string, AnyProcedure>): void {
  for (const [name, procedure] of Object.entries(router)) {
    const annotations = getMcpToolMeta(procedure)?.annotations;

    for (const [hint, expected] of Object.entries(readOnlyToolAnnotations)) {
      const actual: unknown =
        annotations === undefined ? undefined : Reflect.get(annotations, hint);

      if (actual !== expected) {
        throw new Error(`the tool ${name} must set the MCP annotation ${hint} to ${expected}`);
      }
    }
  }
}
