/** Telegram Mini App initData validation (HMAC-SHA256 per Telegram spec). */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/** initData older than this is rejected, so a leaked string can't be replayed forever. */
export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;

/** Returns the signed-in user or throws if initData is missing, forged or stale. */
export function validateInitData(rawInitData: string, botToken: string, now = Date.now()): TelegramUser {
  const params = new URLSearchParams(rawInitData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing hash in initData');
  params.delete('hash');

  const checkString = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('Invalid initData hash');

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > INIT_DATA_MAX_AGE_S) throw new Error('Expired initData');

  const user = params.get('user');
  if (!user) throw new Error('Missing user in initData');
  return JSON.parse(user) as TelegramUser;
}
