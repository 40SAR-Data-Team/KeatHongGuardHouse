/** GET /api/health: 200 if env, Postgres and the Telegram webhook are OK, else 503. Booleans only, no secrets. Point an uptime monitor here. */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ping } from './_lib/db.js';

const ENV = ['BOT_TOKEN', 'WEB_APP_URL', 'TELEGRAM_WEBHOOK_SECRET', 'POSTGRES_URL', 'CRON_SECRET'];
/** A webhook delivery error newer than this marks the bot unhealthy. */
const WEBHOOK_ERROR_WINDOW_S = 10 * 60;

async function webhookOk(): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getWebhookInfo`);
  const { ok, result } = (await res.json()) as { ok: boolean; result?: { url?: string; last_error_date?: number } };
  if (!ok || result?.url !== `${process.env.WEB_APP_URL}/api/bot`) return false;
  return !result.last_error_date || Date.now() / 1000 - result.last_error_date > WEBHOOK_ERROR_WINDOW_S;
}

/** Runs a check, mapping any throw to false. */
const check = (fn: () => Promise<unknown>) => fn().then((v) => v !== false, () => false);

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const env = ENV.every((k) => process.env[k]);
  const [db, webhook] = await Promise.all([check(ping), env ? check(webhookOk) : false]);
  const ok = env && db && webhook;
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({ ok, env, db, webhook });
}
