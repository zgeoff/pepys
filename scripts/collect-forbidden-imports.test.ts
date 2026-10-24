import { expect, test } from 'bun:test';
import { collectForbiddenImports } from './collect-forbidden-imports.ts';

test('it lists a random, poll, socket and file import', () => {
  const text = [
    '(module',
    '  (import "wasi_snapshot_preview1" "clock_time_get" (func (param i32 i64 i32) (result i32)))',
    '  (import "wasi_snapshot_preview1" "random_get" (func (param i32 i32) (result i32)))',
    '  (import "wasi_snapshot_preview1" "poll_oneoff" (func (param i32 i32 i32 i32) (result i32)))',
    '  (import "wasi_snapshot_preview1" "sock_recv" (func (param i32) (result i32)))',
    '  (import "wasi_snapshot_preview1" "path_open" (func (param i32) (result i32)))',
    ')',
  ].join('\n');

  expect(collectForbiddenImports(text)).toStrictEqual([
    '"wasi_snapshot_preview1" "random_get"',
    '"wasi_snapshot_preview1" "poll_oneoff"',
    '"wasi_snapshot_preview1" "sock_recv"',
    '"wasi_snapshot_preview1" "path_open"',
  ]);
});

test('it lists nothing for the imports a consumer needs', () => {
  const text = [
    '(module',
    '  (import "scriptc" "readTicketLength" (func (param i32 i32) (result f64)))',
    '  (import "wasi_snapshot_preview1" "environ_get" (func (param i32 i32) (result i32)))',
    '  (import "wasi_snapshot_preview1" "clock_time_get" (func (param i32 i64 i32) (result i32)))',
    '  (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))',
    ')',
  ].join('\n');

  expect(collectForbiddenImports(text)).toStrictEqual([]);
});
