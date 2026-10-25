import { Hono } from 'hono';
import type { AppEnv, Deps } from './context';
import { ApiFail, errorBody } from './lib/http';
import { checkCsrf, loadSession } from './lib/session';
import { SECURITY_HEADERS } from './lib/security';
import { auth } from './routes/auth';
import { publicRoutes } from './routes/public';
import { participate } from './routes/participate';
import { admin } from './routes/admin';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Builds the API application. Runtime-specific concerns (database driver, static files)
 * are injected, so the same app runs on Cloudflare Workers, Node.js and in tests.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('session', null);
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
    if (deps.config.secureCookies) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  const api = new Hono<AppEnv>();

  api.use('*', async (c, next) => {
    c.set('session', await loadSession(c));
    if (!SAFE_METHODS.has(c.req.method)) checkCsrf(c);
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-cache');
  });

  api.get('/health', (c) => c.json({ ok: true, time: new Date(deps.now()).toISOString() }));
  api.route('/auth', auth);
  api.route('/admin', admin);
  api.route('/', participate);
  api.route('/', publicRoutes);
  api.all('*', (c) => c.json(errorBody('not_found', 'API endpoint not found.'), 404));

  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof ApiFail) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    console.error('Unhandled error', err);
    return c.json(errorBody('server_error', 'Something went wrong on our side. Please try again.'), 500);
  });

  return app;
}
