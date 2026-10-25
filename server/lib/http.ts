import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** A deliberate, user-facing API failure. Rendered as { error: { code, message } }. */
export class ApiFail extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const fail = (status: ContentfulStatusCode, code: string, message: string, details?: unknown) =>
  new ApiFail(status, code, message, details);

export const unauthorized = () => fail(401, 'unauthorized', 'Please log in with Discord first.');
export const forbidden = (message = 'You do not have permission to do that.') => fail(403, 'forbidden', message);
export const notFound = (what = 'Resource') => fail(404, 'not_found', `${what} not found.`);
export const badRequest = (message: string, details?: unknown) => fail(400, 'invalid_request', message, details);

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Reads a JSON object body, rejecting anything else. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    throw fail(415, 'unsupported_media_type', 'Requests must be sent as JSON.');
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Expected a JSON object.');
  return body as Record<string, unknown>;
}

export function intParam(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!value || !Number.isSafeInteger(n) || n <= 0) throw badRequest(`Invalid ${name}.`);
  return n;
}

export function optionalInt(value: string | undefined, name: string): number | null {
  if (value === undefined || value === '') return null;
  return intParam(value, name);
}

export function pagination(c: Context, defaultSize = 24, maxSize = 100) {
  const page = Math.max(1, Math.floor(Number(c.req.query('page') ?? '1')) || 1);
  const size = Math.min(maxSize, Math.max(1, Math.floor(Number(c.req.query('pageSize') ?? defaultSize)) || defaultSize));
  return { page, pageSize: size, offset: (page - 1) * size };
}

export const iso = (ms: number | null | undefined): string | null =>
  ms === null || ms === undefined ? null : new Date(ms).toISOString();
