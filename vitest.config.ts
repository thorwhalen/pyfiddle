import { defineConfig } from 'vitest/config';
import { pyodideDefines } from './src/node';

export default defineConfig({
  define: pyodideDefines(),
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'], testTimeout: 60_000 },
});
