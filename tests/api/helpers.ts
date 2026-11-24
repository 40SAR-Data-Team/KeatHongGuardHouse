/** Test doubles: in-memory db.ts stubs, captured Telegram fetches, waitUntil collector, signed initData and fake req/res. */

import { mock } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { GroupDetail } from '../../shared/rules.ts';

export const BOT_TOKEN = '123:test-token';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.WEB_APP_URL = 'https://example.test';
process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
process.env.CRON_SECRET = 'cron-secret';
process.env.POSTGRES_URL = 'postgres://test';

/** Every db.ts export as a mock; tests set return values per case. */
export const db = {
  listPublicGroups: mock(async () => [] as unknown[]),
  listMyGroups: mock(async () => [] as unknown[]),
  getGroup: mock(async (_code: string, _userId: number): Promise<GroupDetail | null> => null),
  isCodeTaken: mock(async () => false),
  insertGroup: mock(async () => {}),
  joinGroup: mock(async (): Promise<number | null> => 2),
  leaveGroup: mock(async (): Promise<number | null> => 1),
  cancelGroup: mock(async () => {}),
  updateGroup: mock(async () => {}),
  upsertUser: mock(async () => {}),
  getNotifySettings: mock(async () => ({ notify: true, subscriptions: ['food'] })),
  setNotify: mock(async () => {}),
  setSubscriptions: mock(async () => {}),
  getUserTags: mock(async () => [] as { kind: string; key: string; label: string }[]),
  setUserTag: mock(async () => {}),
  listSubscriberIds: mock(async () => [] as number[]),
  countActiveGroups: mock(async () => 0),
  muteCategory: mock(async () => {}),
  deleteOldGroups: mock(async () => 0),
  ping: mock(async () => {}),
};
void mock.module('../../api/_lib/db.ts', () => db);

/** Promises handed to waitUntil; `flush()` awaits them. */
const pending: Promise<unknown>[] = [];
void mock.module('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
export async function flush(): Promise<void> {
  while (pending.length) await pending.shift();
}

/** Telegram sendMessage bodies captured from fetch. */
export const sent: { chat_id: number; text: string; reply_markup: { inline_keyboard: { text: string }[][] } }[] = [];
globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)));
  return new Response('{"ok":true}', { status: 200 });
}) as unknown as typeof fetch;
// grammY calls Telegram via node-fetch; route it through the stub above so tests never hit the network.
void mock.module('node-fetch', () => ({ default: (url: string, init?: RequestInit) => globalThis.fetch(url, init) }));

export function reset(): void {
  for (const fn of Object.values(db)) fn.mockClear();
  db.getGroup.mockImplementation(async () => null); // the only stub tests override persistently (via serve)
  sent.length = 0;
  pending.length = 0;
}

/** initData signed with BOT_TOKEN exactly as Telegram does it. */
export function signInitData(user: { id: number; first_name: string; username?: string }, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'q', user: JSON.stringify(user) });
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

export const LEADER = { id: 1, first_name: 'Lee', username: 'lee' };
export const MEMBER = { id: 2, first_name: 'Max' };
export const OTHER = { id: 3, first_name: 'Oli' };

export function group(over: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: 10, code: 'MANGO427', category: 'food', creatorId: LEADER.id, creatorFirstName: 'Lee', creatorUsername: 'lee',
    title: 'Pizza', description: '', maxMembers: 4, currentCount: 2, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'open', visibility: 'public', joined: false, audience: [],
    members: [{ userId: LEADER.id, firstName: 'Lee', username: 'lee' }, { userId: MEMBER.id, firstName: 'Max', username: null }],
    ...over,
  };
}

interface FakeRes { statusCode: number; body: unknown; headers: Record<string, string> }

/** Calls a Vercel handler with a fake request and returns the captured response. */
export async function call(
  handler: (req: never, res: never) => unknown,
  opts: { method?: string; user?: typeof LEADER | typeof MEMBER | null; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<FakeRes> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.user !== null) headers['x-init-data'] = signInitData(opts.user ?? LEADER);
  const req = { method: opts.method ?? 'GET', headers, body: opts.body, query: opts.query ?? {} };
  const out: FakeRes = { statusCode: 200, body: undefined, headers: {} };
  const res = {
    setHeader: (k: string, v: string) => { out.headers[k] = v; return res; },
    status: (c: number) => { out.statusCode = c; return res; },
    json: (b: unknown) => { out.body = b; return res; },
  };
  await handler(req as never, res as never);
  return out;
}
