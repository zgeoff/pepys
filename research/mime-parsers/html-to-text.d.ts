// html-to-text 10 ships no types, and @types/html-to-text describes version 9.
declare module 'html-to-text' {
  export interface ConvertOptions {
    limits?: { maxDepth?: number };
  }

  export function convert(html: string, options?: ConvertOptions): string;
}
