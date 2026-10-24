const forbiddenImport = /\(import "[^"]+" "(?:random_get|poll_oneoff|sock_[a-z_]+|path_open)"/gu;

// A consumer reads the clock the host binds to a constant and nothing else outside its own memory:
// no random source, no polling, no socket and no file.
export function collectForbiddenImports(text: string): string[] {
  return [...text.matchAll(forbiddenImport)].map((match) => match[0].replace('(import ', ''));
}
