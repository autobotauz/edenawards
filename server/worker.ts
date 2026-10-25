/**
 * Cloudflare Workers entry point. Static assets (the React build) are served by Workers
 * Static Assets; only /api/* requests reach this code (see wrangler.jsonc).
 */
import { createApp } from './app';
import { loadConfig, type EnvLike } from './config';
import { d1Db } from './db';

interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

let cached: { app: ReturnType<typeof createApp>; env: Env } | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!cached || cached.env !== env) {
      const strings: EnvLike = {};
      for (const [k, v] of Object.entries(env)) if (typeof v === 'string') strings[k] = v;
      cached = {
        env,
        app: createApp({
          db: d1Db(env.DB),
          config: loadConfig({ TRUST_PROXY: 'true', ...strings }),
          now: () => Date.now(),
          fetch: (input, init) => fetch(input, init),
        }),
      };
    }
    return cached.app.fetch(request, env, ctx);
  },
};
