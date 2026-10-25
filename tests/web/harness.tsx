import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, Providers } from '../../src/App';
import { setup, T0, type TestEnv } from '../server/helpers';

export const WEB_ORIGIN = 'http://localhost:3000';

/**
 * Runs the real API (in-memory SQLite) behind window.fetch, with a cookie jar, so UI
 * tests exercise the complete request path: React → fetch → Hono → SQLite.
 */
export function harness(envVars: Record<string, string> = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const env: TestEnv = setup({ APP_ORIGIN: WEB_ORIGIN, ...envVars });
  const jar = new Map<string, string>();
  const calls: Array<{ method: string; path: string }> = [];

  const fetchShim = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ method, path });
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (method !== 'GET') headers.set('Origin', WEB_ORIGIN);
    const res = await env.app.request(path, { method, headers, body: init.body as BodyInit | undefined });
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return res;
  };
  vi.stubGlobal('fetch', fetchShim);

  return {
    env,
    calls,
    jar,
    /** Signs in through the real dev-login endpoint (cookie lands in the jar). */
    async login(discordId: string, username = 'Player') {
      const res = await fetchShim('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId, username }),
      });
      if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    },
    render(path: string) {
      return render(
        <MemoryRouter initialEntries={[path]}>
          <Providers>
            <AppRoutes />
          </Providers>
        </MemoryRouter>,
      );
    },
  };
}

export const findText = (text: string | RegExp) => screen.findByText(text, {}, { timeout: 3000 });
