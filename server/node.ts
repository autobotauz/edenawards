/**
 * Node.js entry point: local development and Node hosting (e.g. a Bluehost VPS /
 * cPanel Node.js app behind Cloudflare). Serves the API and the built React app from
 * one origin.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { loadConfig } from './config';
import { openSqlite } from './sqlite';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig(process.env);
const dbPath = process.env.DATABASE_PATH ?? 'data/eden-awards.sqlite';
const { db } = openSqlite(dbPath);

if (config.devLogin && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: DEV_LOGIN is enabled in production. Anyone can sign in as anyone. Disable it now.');
}

const app = createApp({ db, config, now: () => Date.now(), fetch: globalThis.fetch.bind(globalThis) });

const clientDir = resolve(process.env.CLIENT_DIR ?? 'dist/client');
if (existsSync(clientDir)) {
  const indexHtml = readFileSync(resolve(clientDir, 'index.html'), 'utf8');
  // Hashed build assets can be cached forever; index.html must always be revalidated.
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', serveStatic({ root: clientDir }));
  // Single-page app fallback for client-side routes like /vote or /admin.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(`Eden Awards API listening on http://${info.address}:${info.port}`);
  console.log(`  database: ${dbPath}`);
  console.log(`  discord login: ${config.discord ? 'configured' : 'NOT configured'}; dev login: ${config.devLogin ? 'ENABLED' : 'off'}`);
  console.log(`  admins: ${config.adminIds.size}`);
});
