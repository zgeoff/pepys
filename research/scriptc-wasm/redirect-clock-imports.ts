export const deniedNamespace = 'pepys_deny';
const memoryPattern = /\n {2}\(memory \(;0;\) (?<pages>\d+)\)/u;
const importLinePattern = /\n {2}\(import [^\n]*/gu;

export function redirectClockImports(text: string, memory: 'own' | 'denied'): string {
  const redirected = ['clock_time_get', 'random_get'].reduce(
    (current, name) =>
      current.replaceAll(
        `(import "wasi_snapshot_preview1" "${name}"`,
        `(import "${deniedNamespace}" "${name}"`,
      ),
    text,
  );

  if (memory === 'own') {
    return redirected;
  }

  const memoryMatch = memoryPattern.exec(redirected);
  const pages = memoryMatch?.groups?.['pages'];

  if (memoryMatch === null || pages === undefined) {
    throw new Error('the module text declares no memory to import');
  }

  const withoutMemory = redirected.replace(memoryMatch[0], '');
  const lastImport = [...withoutMemory.matchAll(importLinePattern)].at(-1);

  if (lastImport === undefined) {
    throw new Error('the module text has no import to follow');
  }

  const insertAt = lastImport.index + lastImport[0].length;

  // A memory import must come before every defined table, memory and global.
  return `${withoutMemory.slice(0, insertAt)}\n  (import "${deniedNamespace}" "memory" (memory (;0;) ${pages}))${withoutMemory.slice(insertAt)}`;
}
