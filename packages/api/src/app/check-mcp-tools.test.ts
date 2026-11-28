import { expect, onTestFinished, test } from 'bun:test';
import { mcp } from '@orpc/mcp';
import { os } from '@orpc/server';
import { checkDeployment, defineDeployment, defineQuery } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { buildQueryContext } from '../queries/build-query-context.ts';
import { harbourPlugin } from '../test-utils/harbour/harbour-plugin.ts';
import { checkMCPTools } from './check-mcp-tools.ts';
import { createRouter } from './create-router.ts';

async function setupTest() {
  const deployment = defineDeployment({ name: 'harbour', plugins: [harbourPlugin] });

  const store = await createTestStore({ plugins: [harbourPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  const checked = checkDeployment(deployment);

  invariant(checked.ok, 'the harbour deployment is valid');

  const context = buildQueryContext(store.reader, checked.value);

  const allHints = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };

  return {
    allHints,
    withoutHint: (missing: string) =>
      Object.fromEntries(Object.entries(allHints).filter((entry) => entry[0] !== missing)),
    checkShipped: async () => {
      await checkMCPTools(createRouter(checked.value.queries), context);

      return 'checked';
    },

    // a plug-in query with the given output, served by the real router
    checkQueryOutput: (shape: 'array' | 'scalar' | 'nullable' | 'file') => {
      const outputs = {
        array: z.array(z.string()),
        scalar: z.number(),
        nullable: z.object({}).nullable(),
        file: z.object({ report: z.file() }),
      };

      const query = defineQuery({
        name: 'harbour_tide',
        description: 'Gives the tide.',
        input: z.object({}),
        output: outputs[shape],
        reads: [],
        handler: () => Promise.reject(new Error('never called')),
      });

      return checkMCPTools(createRouter([query]), context);
    },

    // a router of one hand-built tool, standing in for a core tool
    checkTool: (output: z.ZodType, annotations: Record<string, boolean>) => {
      const tool = os
        .meta(mcp.tool({ annotations }))
        .input(z.object({}))
        .output(output)
        .handler(() => ({}));

      return checkMCPTools({ get_entity: tool }, context);
    },
  };
}

test('#checkMCPTools accepts the core tools and the plug-in queries as they ship', async () => {
  const ctx = await setupTest();
  const result = await ctx.checkShipped();

  expect(result).toBe('checked');
});

test.each([
  { shape: 'a bare array', kind: 'array' as const },
  { shape: 'a scalar', kind: 'scalar' as const },
  { shape: 'a nullable object', kind: 'nullable' as const },
  { shape: 'an object that holds a file', kind: 'file' as const },
])('#checkMCPTools refuses a plug-in query whose output is $shape', async (row) => {
  const ctx = await setupTest();

  expect(ctx.checkQueryOutput(row.kind)).rejects.toThrow(
    /harbour_tide lists no output schema of type object/u,
  );
});

test('#checkMCPTools refuses a core tool whose output is an array', async () => {
  const ctx = await setupTest();

  const output = z.array(z.string());

  expect(ctx.checkTool(output, ctx.allHints)).rejects.toThrow(
    /get_entity lists no output schema of type object/u,
  );
});

test.each([
  { missing: 'readOnlyHint' },
  { missing: 'destructiveHint' },
  { missing: 'idempotentHint' },
  { missing: 'openWorldHint' },
])('#checkMCPTools refuses a tool that leaves out $missing', async (row) => {
  const ctx = await setupTest();

  const annotations = ctx.withoutHint(row.missing);

  expect(ctx.checkTool(z.object({}), annotations)).rejects.toThrow(
    new RegExp(`get_entity must list the MCP annotation ${row.missing}`, 'u'),
  );
});

test('#checkMCPTools refuses a tool that sets a hint the wrong way', async () => {
  const ctx = await setupTest();

  const annotations = { ...ctx.allHints, openWorldHint: true };

  expect(ctx.checkTool(z.object({}), annotations)).rejects.toThrow(
    /get_entity must list the MCP annotation openWorldHint as false/u,
  );
});
