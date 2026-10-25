// Bundles the Node server into dist/server/node.js (dependencies stay external).
import { build } from 'esbuild';

await build({
  entryPoints: ['server/node.ts'],
  outfile: 'dist/server/node.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
