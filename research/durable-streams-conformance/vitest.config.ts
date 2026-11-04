import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['conformance.vitest.ts'], root: import.meta.dirname },
});
