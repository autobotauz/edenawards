/**
 * jsdom, but transformed by Vite's SSR environment so the in-process API used by the
 * web tests can import Node built-ins such as node:sqlite.
 */
import { builtinEnvironments, type Environment } from 'vitest/runtime';

export default {
  ...builtinEnvironments.jsdom,
  name: 'jsdom-ssr',
  viteEnvironment: 'ssr',
} satisfies Environment;
