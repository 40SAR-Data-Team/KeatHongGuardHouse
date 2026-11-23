/** JSON response helpers and the `withAuth` wrapper every authed route uses. */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateInitData, type TelegramUser } from './auth.js';
import { upsertUser } from './db.js';

type AuthedHandler = (req: VercelRequest, res: VercelResponse, user: TelegramUser) => Promise<void>;

/** Throw inside a handler to send `{ error: message }` with `status`. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function ok(res: VercelResponse, data: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(data);
}

function fail(res: VercelResponse, status: number, message: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error: message });
}

/** Postgres unique-violation code, unwrapped from drizzle's DrizzleQueryError. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}

/** Reads the `[code]` path param of a dynamic route, uppercased. */
export function codeParam(req: VercelRequest): string {
  const { code } = req.query;
  if (!code || typeof code !== 'string') throw new ApiError(400, 'Missing group code');
  return code.toUpperCase();
}

/** The parsed JSON body, or {} when absent/non-object. */
export function bodyOf(req: VercelRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
}

/** 405 on unmapped methods, 401 on bad initData, upserts the user, maps ApiError to its status and anything else to 500. */
export function withAuth(handlers: Partial<Record<'GET' | 'POST' | 'PATCH', AuthedHandler>>) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const handler = handlers[req.method as keyof typeof handlers];
    if (!handler) return fail(res, 405, 'Method not allowed');
    try {
      const raw = req.headers['x-init-data'];
      if (!raw || typeof raw !== 'string') throw new ApiError(401, 'Missing x-init-data header');
      const botToken = process.env.BOT_TOKEN;
      if (!botToken) throw new ApiError(500, 'Server misconfiguration');

      let user: TelegramUser;
      try {
        user = validateInitData(raw, botToken);
      } catch (e) {
        throw new ApiError(401, (e as Error).message);
      }
      await upsertUser(user.id, user.username ?? null, user.first_name);
      await handler(req, res, user);
    } catch (e) {
      if (e instanceof ApiError) return fail(res, e.status, e.message);
      console.error(e);
      fail(res, 500, 'Internal server error');
    }
  };
}
