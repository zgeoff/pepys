import { expect, test } from 'bun:test';
import { pickGlueStep } from './pick-glue-step.ts';
import type { GlueStep, GlueStepInput } from './pick-glue-step.ts';

test.each<[string, GlueStepInput, GlueStep]>([
  [
    'a check with every file fresh writes nothing and counts the files',
    {
      glue: [{ path: '/plug/gen/tide.sql', content: 'sql' }],
      committed: new Map([['/plug/gen/tide.sql', 'sql']]),
      isCheck: true,
      out: undefined,
      tools: { scriptc: '/bin/scriptc', zig: undefined, wasmTools: undefined },
    },
    { kind: 'done', write: [], outcome: { kind: 'fresh', count: 1 } },
  ],
  [
    'a check with a changed and a missing file writes nothing and names both',
    {
      glue: [
        { path: '/plug/gen/tide.sql', content: 'new sql' },
        { path: '/plug/gen/tide-boundary.ts', content: 'ts' },
      ],
      committed: new Map([['/plug/gen/tide.sql', 'old sql']]),
      isCheck: true,
      out: '/plug/build',
      tools: { scriptc: '/bin/scriptc', zig: '/bin/zig', wasmTools: '/bin/wasm-tools' },
    },
    {
      kind: 'done',
      write: [],
      outcome: { kind: 'stale', stale: ['/plug/gen/tide.sql', '/plug/gen/tide-boundary.ts'] },
    },
  ],
  [
    'a build with no out writes the stale file and stops',
    {
      glue: [
        { path: '/plug/gen/tide.sql', content: 'new sql' },
        { path: '/plug/gen/tide-boundary.ts', content: 'ts' },
      ],
      committed: new Map([
        ['/plug/gen/tide.sql', 'old sql'],
        ['/plug/gen/tide-boundary.ts', 'ts'],
      ]),
      isCheck: false,
      out: undefined,
      tools: { scriptc: '/bin/scriptc', zig: undefined, wasmTools: undefined },
    },
    {
      kind: 'done',
      write: [{ path: '/plug/gen/tide.sql', content: 'new sql' }],
      outcome: {
        kind: 'built',
        written: ['/plug/gen/tide.sql'],
        unchanged: ['/plug/gen/tide-boundary.ts'],
      },
    },
  ],
  [
    'a module build with no zig still writes the stale glue',
    {
      glue: [{ path: '/plug/gen/tide.sql', content: 'sql' }],
      committed: new Map(),
      isCheck: false,
      out: '/plug/build',
      tools: { scriptc: '/bin/scriptc', zig: undefined, wasmTools: '/bin/wasm-tools' },
    },
    {
      kind: 'done',
      write: [{ path: '/plug/gen/tide.sql', content: 'sql' }],
      outcome: { kind: 'missing-tool', tool: 'zig' },
    },
  ],
  [
    'a module build with no wasm-tools still writes the stale glue',
    {
      glue: [{ path: '/plug/gen/tide.sql', content: 'sql' }],
      committed: new Map(),
      isCheck: false,
      out: '/plug/build',
      tools: { scriptc: '/bin/scriptc', zig: '/bin/zig', wasmTools: undefined },
    },
    {
      kind: 'done',
      write: [{ path: '/plug/gen/tide.sql', content: 'sql' }],
      outcome: { kind: 'missing-tool', tool: 'wasm-tools' },
    },
  ],
  [
    'a module build with both tools writes the stale glue and compiles',
    {
      glue: [
        { path: '/plug/gen/tide.sql', content: 'sql' },
        { path: '/plug/gen/tide-boundary.ts', content: 'ts' },
      ],
      committed: new Map([['/plug/gen/tide-boundary.ts', 'ts']]),
      isCheck: false,
      out: '/plug/build',
      tools: { scriptc: '/bin/scriptc', zig: '/bin/zig', wasmTools: '/bin/wasm-tools' },
    },
    {
      kind: 'compile',
      write: [{ path: '/plug/gen/tide.sql', content: 'sql' }],
      written: ['/plug/gen/tide.sql'],
      unchanged: ['/plug/gen/tide-boundary.ts'],
      out: '/plug/build',
      tools: { scriptc: '/bin/scriptc', zig: '/bin/zig', wasmTools: '/bin/wasm-tools' },
    },
  ],
])('it picks the step for %s', (_title, input, expected) => {
  expect(pickGlueStep(input)).toStrictEqual(expected);
});
