import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { BOT_TOKEN, LEADER, MEMBER, OTHER, group, reset, sent, signInitData } from './helpers.ts';
import { INIT_DATA_MAX_AGE_S, validateInitData } from '../../api/_lib/auth.ts';
import { generateUniqueCode } from '../../api/_lib/codegen.ts';
import {
  parseBroadcast, parseCategories, parseCreateBody, parseMaxMembers, parseTagPatch, parseUserId, parseVisibility, str,
} from '../../api/_lib/validation.ts';
import { ApiError, isUniqueViolation } from '../../api/_lib/response.ts';
import {
  notifyBroadcast, notifyCancelled, notifyJoin, notifyKicked, notifyNewGroup,
} from '../../api/_lib/telegram.ts';

beforeEach(reset);

describe('validateInitData', () => {
  test('accepts a correctly signed payload', () => {
    expect(validateInitData(signInitData(LEADER), BOT_TOKEN).id).toBe(LEADER.id);
  });
  test('rejects a tampered payload', () => {
    const tampered = signInitData(LEADER).replace('%22Lee%22', '%22Eve%22');
    expect(() => validateInitData(tampered, BOT_TOKEN)).toThrow('Invalid initData hash');
  });
  test('rejects the wrong bot token', () => {
    expect(() => validateInitData(signInitData(LEADER), '999:other')).toThrow('Invalid initData hash');
  });
  test('rejects a missing hash and stale auth_date', () => {
    expect(() => validateInitData('user=%7B%7D', BOT_TOKEN)).toThrow('Missing hash');
    const old = Math.floor(Date.now() / 1000) - INIT_DATA_MAX_AGE_S - 60;
    expect(() => validateInitData(signInitData(LEADER, old), BOT_TOKEN)).toThrow('Expired initData');
  });
});

describe('generateUniqueCode', () => {
  test('returns WORD + 3 digits and retries collisions', async () => {
    let calls = 0;
    const code = await generateUniqueCode(async () => ++calls < 3);
    expect(code).toMatch(/^[A-Z]+\d{3}$/);
    expect(calls).toBe(3);
  });
  test('gives up after maxRetries', async () => {
    expect(generateUniqueCode(async () => true, 2)).rejects.toThrow('unique');
  });
});

describe('validation', () => {
  const bad = (fn: () => unknown) => expect(fn).toThrow(ApiError);

  test('parseCreateBody: happy path and defaults', () => {
    expect(parseCreateBody({ title: ' Pizza ', category: 'food', expiryMinutes: 60 })).toEqual({
      title: 'Pizza', description: '', expiryMinutes: 60, category: 'food', maxMembers: null, visibility: 'public', audienceKinds: [],
    });
  });
  test('parseCreateBody: rejects bad fields', () => {
    bad(() => parseCreateBody({ title: '', category: 'food', expiryMinutes: 60 }));
    bad(() => parseCreateBody({ title: { x: 1 }, category: 'food', expiryMinutes: 60 }));
    bad(() => parseCreateBody({ title: 'x', category: 'nope', expiryMinutes: 60 }));
    bad(() => parseCreateBody({ title: 'x', category: 'food', expiryMinutes: 5 }));
    bad(() => parseCreateBody({ title: 'x', category: 'food', expiryMinutes: 60, audienceKinds: ['rank'] }));
  });
  test('parseCreateBody: dedupes audience kinds', () => {
    expect(parseCreateBody({ title: 'x', category: 'food', expiryMinutes: 60, audienceKinds: ['unit', 'unit'] }).audienceKinds).toEqual(['unit']);
  });
  test('parseMaxMembers / parseVisibility / parseCategories', () => {
    expect(parseMaxMembers(null)).toBeNull();
    expect(parseMaxMembers('5')).toBe(5);
    bad(() => parseMaxMembers(1));
    bad(() => parseMaxMembers(2.5));
    expect(parseVisibility(undefined)).toBe('public');
    bad(() => parseVisibility('secret'));
    expect(parseCategories(['food', 'food', 'grab'])).toEqual(['food', 'grab']);
    bad(() => parseCategories('food'));
  });
  test('parseTagPatch', () => {
    expect(parseTagPatch({ unit: ' 3 SIR ', company: null })).toEqual({ unit: '3 SIR', company: null });
    bad(() => parseTagPatch([]));
    bad(() => parseTagPatch({ rank: 'x' }));
    bad(() => parseTagPatch({ role: 'Chef' }));
    bad(() => parseTagPatch({ unit: 5 }));
  });
  test('parseBroadcast / parseUserId / str', () => {
    expect(parseBroadcast('  hi ')).toBe('hi');
    bad(() => parseBroadcast('   '));
    bad(() => parseBroadcast('x'.repeat(501)));
    expect(parseUserId('42')).toBe(42);
    bad(() => parseUserId(-1));
    bad(() => parseUserId('abc'));
    expect(str({})).toBe('');
  });
  test('isUniqueViolation reads direct and wrapped codes', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
  });
});

describe('telegram DMs', () => {
  const g = group({ members: [
    { userId: LEADER.id, firstName: 'Lee', username: 'lee' },
    { userId: MEMBER.id, firstName: 'Max', username: null },
    { userId: OTHER.id, firstName: 'Oli', username: 'oli' },
  ] });
  const ids = () => sent.map((m) => m.chat_id).sort();

  test('new group DM has a view link and a mute button', async () => {
    await notifyNewGroup([7, 8], g);
    expect(ids()).toEqual([7, 8]);
    expect(sent[0]!.reply_markup.inline_keyboard.flat().map((b) => b.text)).toEqual(['View group', '🔕 Mute Food alerts']);
  });
  test('join DMs joiner and leader; on full, everyone else too', async () => {
    await notifyJoin({ ...g, status: 'open' }, MEMBER.id);
    expect(ids()).toEqual([LEADER.id, MEMBER.id]);
    sent.length = 0;
    await notifyJoin({ ...g, status: 'full' }, MEMBER.id);
    expect(ids()).toEqual([LEADER.id, MEMBER.id, OTHER.id]);
    expect(sent.find((m) => m.chat_id === OTHER.id)!.text).toContain('now full');
  });
  test('join by a non-member sends nothing', async () => {
    await notifyJoin(g, 999);
    expect(sent).toHaveLength(0);
  });
  test('cancel, broadcast and kick skip the leader', async () => {
    await notifyCancelled(g);
    expect(ids()).toEqual([MEMBER.id, OTHER.id]);
    sent.length = 0;
    await notifyBroadcast(g, 'Meet at 1830');
    expect(ids()).toEqual([MEMBER.id, OTHER.id]);
    expect(sent[0]!.text).toContain('Meet at 1830');
    sent.length = 0;
    await notifyKicked(g, OTHER.id);
    expect(ids()).toEqual([OTHER.id]);
  });
  test('batches past 25 recipients and never throws on failures', async () => {
    const original = globalThis.fetch;
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    globalThis.fetch = (async () => { n++; if (n % 2) throw new Error('down'); return new Response('no', { status: 403 }); }) as unknown as typeof fetch;
    await notifyNewGroup(Array.from({ length: 30 }, (_, i) => i + 100), g);
    globalThis.fetch = original;
    warn.mockRestore();
    expect(n).toBe(30);
  });
});
