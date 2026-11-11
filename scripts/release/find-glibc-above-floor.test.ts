import { expect, test } from 'bun:test';
import { findGlibcAboveFloor } from './find-glibc-above-floor.ts';

test.each([
  {
    title: 'null for symbols no newer than the floor',
    objdumpText:
      '0000 DF *UND* 0000 (GLIBC_2.2.5) malloc\n0000 DF *UND* 0000 (GLIBC_2.35) __libc_start_main\n',
    found: null,
  },
  {
    title: 'the newest version above the floor',
    objdumpText:
      '0000 DF *UND* 0000 (GLIBC_2.38) __isoc23_strtol\n0000 DF *UND* 0000 (GLIBC_2.44) sinh\n0000 DF *UND* 0000 (GLIBC_2.36) arc4random\n',
    found: '2.44',
  },
  {
    title: 'a version above the floor by its third part',
    objdumpText: '0000 DF *UND* 0000 (GLIBC_2.35.1) open\n',
    found: '2.35.1',
  },
  {
    title: 'null for a binary with no glibc symbols',
    objdumpText: 'DYNAMIC SYMBOL TABLE:\n',
    found: null,
  },
])('it returns $title', (row) => {
  expect(findGlibcAboveFloor(row.objdumpText, '2.35')).toBe(row.found);
});
