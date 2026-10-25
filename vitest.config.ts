import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['tests/server/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'web',
          // The web tests run the real API in-process, which needs Node built-ins (node:sqlite).
          environment: './tests/web/jsdom-env.ts',
          include: ['tests/web/**/*.test.tsx'],
          setupFiles: ['tests/web/setup.ts'],
          testTimeout: 20000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        'server/node.ts',
        'server/worker.ts',
        'server/scripts/**',
        'src/main.tsx',
        'src/**/*.d.ts',
      ],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
