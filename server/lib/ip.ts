import type { Ctx } from '../context';

/**
 * Best-effort client IP for rate limiting. Proxy headers are only trusted when
 * TRUST_PROXY=true (always the case on Cloudflare Workers, where Cloudflare sets
 * CF-Connecting-IP itself; set it on Node only when the server is reachable solely
 * through Cloudflare or another trusted proxy).
 */
export function clientIp(c: Ctx): string {
  if (!c.var.deps.config.trustProxy) {
    // @hono/node-server exposes the raw Node request as env.incoming.
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    return env?.incoming?.socket?.remoteAddress ?? 'direct';
  }
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}
