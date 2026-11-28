import { expect, test } from 'bun:test';
import { mcp } from '@orpc/mcp';
import { os } from '@orpc/server';
import { readOnlyToolAnnotations } from '@pepys/contract';
import { z } from 'zod';
import { checkToolAnnotations } from './check-tool-annotations.ts';

function setupTest() {
  const base = os.input(z.object({})).output(z.object({}));

  return {
    annotated: (annotations: Record<string, boolean>) =>
      base.meta(mcp.tool({ annotations })).handler(() => ({})),
    bare: () => base.handler(() => ({})),
  };
}

test('#checkToolAnnotations accepts a tool with the read-only annotations', () => {
  const ctx = setupTest();
  const router = { harbour_tide: ctx.annotated({ ...readOnlyToolAnnotations }) };

  expect(() => checkToolAnnotations(router)).not.toThrow();
});

test('#checkToolAnnotations refuses a tool with no annotations', () => {
  const ctx = setupTest();
  const router = { harbour_tide: ctx.bare() };

  expect(() => checkToolAnnotations(router)).toThrow(
    /harbour_tide must set the MCP annotation readOnlyHint to true/u,
  );
});

test('#checkToolAnnotations refuses a tool that sets a hint the wrong way', () => {
  const ctx = setupTest();

  const router = {
    harbour_tide: ctx.annotated({ ...readOnlyToolAnnotations, openWorldHint: true }),
  };

  expect(() => checkToolAnnotations(router)).toThrow(
    /harbour_tide must set the MCP annotation openWorldHint to false/u,
  );
});
