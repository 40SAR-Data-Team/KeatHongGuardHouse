/** GET /api/cron (Bearer CRON_SECRET, sent by Vercel Cron per vercel.json): deletes groups expired over RETENTION_DAYS. */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { deleteOldGroups } from './_lib/db.js';

function authorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json({ deleted: await deleteOldGroups() });
}
