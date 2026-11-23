import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { LEADER, MEMBER, OTHER, call, db, flush, group, reset, sent } from './helpers.ts';
import type { GroupDetail } from '../../shared/rules.ts';

const groupsRoute = (await import('../../api/groups/index.ts')).default;
const codeRoute = (await import('../../api/groups/[code]/index.ts')).default;
const meRoute = (await import('../../api/users/me/index.ts')).default;
const cronRoute = (await import('../../api/cron.ts')).default;

beforeEach(reset);

/** Makes getGroup return `g`, with `joined` computed for the caller. */
function serve(g: GroupDetail) {
  db.getGroup.mockImplementation(async (_code, userId) => ({ ...g, joined: g.members.some((m) => m.userId === userId) }));
}
const act = (user: typeof LEADER, body: Record<string, unknown>) =>
  call(codeRoute, { method: 'POST', user, body, query: { code: 'mango427' } });

describe('withAuth', () => {
  test('405 on an unmapped method', async () => {
    expect((await call(groupsRoute, { method: 'DELETE' })).statusCode).toBe(405);
  });
  test('401 without or with forged initData', async () => {
    expect((await call(groupsRoute, { user: null })).statusCode).toBe(401);
    expect((await call(groupsRoute, { user: null, headers: { 'x-init-data': 'hash=00&user=%7B%7D' } })).statusCode).toBe(401);
  });
  test('500 without leaking internals', async () => {
    const err = spyOn(console, 'error').mockImplementation(() => {});
    db.listPublicGroups.mockImplementationOnce(async () => { throw new Error('db down'); });
    const res = await call(groupsRoute);
    err.mockRestore();
    expect(res).toMatchObject({ statusCode: 500, body: { error: 'Internal server error' } });
  });
  test('500 when BOT_TOKEN is unset', async () => {
    const token = process.env.BOT_TOKEN;
    const header = { 'x-init-data': 'hash=00' };
    delete process.env.BOT_TOKEN;
    const res = await call(groupsRoute, { user: null, headers: header });
    process.env.BOT_TOKEN = token;
    expect(res.statusCode).toBe(500);
  });
});

describe('/api/groups', () => {
  const create = { title: 'Pizza', category: 'food', expiryMinutes: 60 };

  test('GET lists public groups, or mine', async () => {
    await call(groupsRoute);
    expect(db.listPublicGroups).toHaveBeenCalledWith(LEADER.id);
    expect(db.upsertUser).toHaveBeenCalledWith(LEADER.id, 'lee', 'Lee');
    await call(groupsRoute, { query: { mine: '1' } });
    expect(db.listMyGroups).toHaveBeenCalledWith(LEADER.id);
  });
  test('POST creates and DMs subscribers of public groups', async () => {
    serve(group());
    db.listSubscriberIds.mockImplementationOnce(async () => [OTHER.id]);
    const res = await call(groupsRoute, { method: 'POST', body: create });
    await flush();
    expect(res.statusCode).toBe(200);
    expect(db.insertGroup).toHaveBeenCalledTimes(1);
    expect(sent.map((m) => m.chat_id)).toEqual([OTHER.id]);
  });
  test('POST private group sends no blast', async () => {
    serve(group({ visibility: 'private' }));
    await call(groupsRoute, { method: 'POST', body: { ...create, visibility: 'private' } });
    await flush();
    expect(db.listSubscriberIds).not.toHaveBeenCalled();
  });
  test('POST is capped at MAX_ACTIVE_GROUPS', async () => {
    db.countActiveGroups.mockImplementationOnce(async () => 3);
    const res = await call(groupsRoute, { method: 'POST', body: create });
    expect(res.statusCode).toBe(429);
    expect(db.insertGroup).not.toHaveBeenCalled();
  });
  test('POST cannot target a tag the creator lacks', async () => {
    const res = await call(groupsRoute, { method: 'POST', body: { ...create, audienceKinds: ['unit'] } });
    expect(res).toMatchObject({ statusCode: 400, body: { error: 'Set your unit tag in Settings before targeting it' } });
  });
  test('POST rejects an invalid body', async () => {
    expect((await call(groupsRoute, { method: 'POST', body: 'nope' })).statusCode).toBe(400);
  });
});

describe('/api/groups/[code]', () => {
  test('GET 404 for a missing or hidden group', async () => {
    expect((await call(codeRoute, { query: { code: 'x' } })).statusCode).toBe(404);
  });
  test('GET uppercases the code; 400 without one', async () => {
    serve(group());
    expect((await call(codeRoute, { query: { code: 'mango427' } })).statusCode).toBe(200);
    expect(db.getGroup.mock.calls[0]![0]).toBe('MANGO427');
    expect((await call(codeRoute)).statusCode).toBe(400);
  });

  test('join DMs joiner and leader', async () => {
    serve(group());
    const res = await act(OTHER, { action: 'join' });
    await flush();
    expect(res.statusCode).toBe(200);
    expect(db.joinGroup).toHaveBeenCalledWith(10, OTHER.id);
    // getGroup is stubbed, so OTHER isn't in members: notifyJoin skips. Covered in lib tests.
  });
  test('join conflicts: already member, full, raced full, duplicate', async () => {
    serve(group());
    expect((await act(MEMBER, { action: 'join' })).statusCode).toBe(409);
    serve(group({ status: 'full' }));
    expect((await act(OTHER, { action: 'join' })).statusCode).toBe(409);
    serve(group());
    db.joinGroup.mockImplementationOnce(async () => null);
    expect((await act(OTHER, { action: 'join' })).body).toEqual({ error: 'Group just filled up or closed' });
    db.joinGroup.mockImplementationOnce(async () => { throw { code: '23505' }; });
    expect((await act(OTHER, { action: 'join' })).body).toEqual({ error: 'Already a member of this group' });
  });
  test('closed groups reject every action', async () => {
    serve(group({ status: 'expired' }));
    expect((await act(OTHER, { action: 'join' })).body).toEqual({ error: 'Group is expired' });
  });
  test('unknown action is 400', async () => {
    serve(group());
    expect((await act(LEADER, { action: 'explode' })).statusCode).toBe(400);
  });

  test('leave: members only, never the leader', async () => {
    serve(group());
    expect((await act(MEMBER, { action: 'leave' })).statusCode).toBe(200);
    expect(db.leaveGroup).toHaveBeenCalledWith(10, MEMBER.id);
    expect((await act(LEADER, { action: 'leave' })).statusCode).toBe(403);
    expect((await act(OTHER, { action: 'leave' })).statusCode).toBe(409);
    db.leaveGroup.mockImplementationOnce(async () => null);
    expect((await act(MEMBER, { action: 'leave' })).statusCode).toBe(409);
  });

  test('cancel: leader only, DMs members', async () => {
    serve(group());
    expect((await act(MEMBER, { action: 'cancel' })).statusCode).toBe(403);
    expect((await act(LEADER, { action: 'cancel' })).statusCode).toBe(200);
    await flush();
    expect(db.cancelGroup).toHaveBeenCalledWith(10);
    expect(sent.map((m) => m.chat_id)).toEqual([MEMBER.id]);
  });

  test('kick: leader removes a member and DMs them', async () => {
    serve(group());
    expect((await act(LEADER, { action: 'kick', userId: MEMBER.id })).statusCode).toBe(200);
    await flush();
    expect(db.leaveGroup).toHaveBeenCalledWith(10, MEMBER.id);
    expect(sent[0]!.chat_id).toBe(MEMBER.id);
  });
  test('kick guards', async () => {
    serve(group());
    expect((await act(MEMBER, { action: 'kick', userId: LEADER.id })).statusCode).toBe(403);
    expect((await act(LEADER, { action: 'kick', userId: LEADER.id })).statusCode).toBe(400);
    expect((await act(LEADER, { action: 'kick', userId: 'x' })).statusCode).toBe(400);
    db.leaveGroup.mockImplementationOnce(async () => null);
    expect((await act(LEADER, { action: 'kick', userId: OTHER.id })).statusCode).toBe(409);
  });

  test('broadcast: leader messages every member', async () => {
    serve(group());
    expect((await act(LEADER, { action: 'broadcast', message: 'Meet 1830' })).statusCode).toBe(200);
    await flush();
    expect(sent.map((m) => m.chat_id)).toEqual([MEMBER.id]);
  });
  test('broadcast guards', async () => {
    serve(group());
    expect((await act(MEMBER, { action: 'broadcast', message: 'hi' })).statusCode).toBe(403);
    expect((await act(LEADER, { action: 'broadcast', message: '' })).statusCode).toBe(400);
  });

  test('PATCH updates leader settings', async () => {
    serve(group());
    const patch = (user: typeof LEADER, body: unknown) => call(codeRoute, { method: 'PATCH', user, body, query: { code: 'MANGO427' } });
    expect((await patch(LEADER, { maxMembers: 5, visibility: 'private' })).statusCode).toBe(200);
    expect(db.updateGroup).toHaveBeenCalledWith(10, { maxMembers: 5, visibility: 'private' });
    expect((await patch(MEMBER, { maxMembers: 5 })).statusCode).toBe(403);
    expect((await patch(LEADER, {})).statusCode).toBe(400);
    serve(group({ currentCount: 3 }));
    expect((await patch(LEADER, { maxMembers: 2 })).statusCode).toBe(400);
    serve(group({ status: 'cancelled' }));
    expect((await patch(LEADER, { maxMembers: 5 })).statusCode).toBe(409);
  });
});

describe('/api/users/me', () => {
  test('GET returns profile with settings and tags', async () => {
    const res = await call(meRoute);
    expect(res.body).toMatchObject({ id: LEADER.id, username: 'lee', notify: true, subscriptions: ['food'], tags: [] });
  });
  test('PATCH applies notify, subscriptions and tags', async () => {
    const res = await call(meRoute, { method: 'PATCH', body: { notify: false, subscriptions: ['grab'], tags: { unit: '3 SIR' } } });
    expect(res.statusCode).toBe(200);
    expect(db.setNotify).toHaveBeenCalledWith(LEADER.id, false);
    expect(db.setSubscriptions).toHaveBeenCalledWith(LEADER.id, ['grab']);
    expect(db.setUserTag).toHaveBeenCalledWith(LEADER.id, 'unit', '3 SIR');
  });
  test('PATCH rejects a non-boolean notify', async () => {
    expect((await call(meRoute, { method: 'PATCH', body: { notify: 'yes' } })).statusCode).toBe(400);
  });
});

describe('/api/cron', () => {
  const auth = (v: string) => ({ user: null, headers: { authorization: v } });

  test('401 without the secret', async () => {
    expect((await call(cronRoute, { user: null })).statusCode).toBe(401);
    expect((await call(cronRoute, auth('Bearer wrong'))).statusCode).toBe(401);
  });
  test('deletes old groups', async () => {
    db.deleteOldGroups.mockImplementationOnce(async () => 4);
    const res = await call(cronRoute, auth('Bearer cron-secret'));
    expect(res).toMatchObject({ statusCode: 200, body: { deleted: 4 } });
  });
});

describe('bot mute button', async () => {
  const { onMute } = await import('../../api/bot.ts');
  const ctx = (data: string) => {
    const answers: string[] = [];
    return { answers, match: /^mute:(\w+)$/.exec(data)!, from: { id: MEMBER.id }, answerCallbackQuery: async (t: string) => answers.push(t) };
  };

  test('mutes a known category', async () => {
    const c = ctx('mute:food');
    await onMute(c);
    expect(db.muteCategory).toHaveBeenCalledWith(MEMBER.id, 'food');
    expect(c.answers[0]).toContain('Muted Food');
  });
  test('ignores an unknown category', async () => {
    const c = ctx('mute:hax');
    await onMute(c);
    expect(db.muteCategory).not.toHaveBeenCalled();
    expect(c.answers).toEqual(['Unknown category']);
  });
});
