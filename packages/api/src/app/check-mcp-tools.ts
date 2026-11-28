import { McpServer } from '@modelcontextprotocol/server';
import { McpRegistrar } from '@orpc/mcp';
import type { Router } from '@orpc/server';
import type { QueryContext } from '../queries/types.ts';

// Every pepys query only reads its own data. A client that sees a hint missing treats the tool as
// one that writes, deletes and reaches outside, and asks before each call.
const requiredAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Registers the router on a real MCP server, as each /mcp request does, and checks each tool as the
// server would list it: an object output schema, which MCP clients need, and the four annotations.
// It throws on the first tool that breaks either, so the API refuses to start.
export async function checkMCPTools(
  router: Router<QueryContext>,
  context: QueryContext,
): Promise<void> {
  const server = new McpServer({ name: 'pepys-check', version: '1.0.0' });
  const registrar = new McpRegistrar(router, {});

  const registered = await registrar.register(server, { context });

  for (const [name, tool] of Object.entries(registered.tools)) {
    const outputSchema = tool.outputSchema?.['~standard'].jsonSchema.output({
      target: 'draft-2020-12',
    });

    if (outputSchema?.['type'] !== 'object') {
      throw new Error(
        `the tool ${name} lists no output schema of type object, which an MCP client needs`,
      );
    }

    for (const [hint, expected] of Object.entries(requiredAnnotations)) {
      const actual: unknown =
        tool.annotations === undefined ? undefined : Reflect.get(tool.annotations, hint);

      if (actual !== expected) {
        throw new Error(`the tool ${name} must list the MCP annotation ${hint} as ${expected}`);
      }
    }
  }
}
