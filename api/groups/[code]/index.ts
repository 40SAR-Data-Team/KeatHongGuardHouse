/** GET /api/groups/[code]: detail. PATCH: leader settings. POST { action: join | leave | cancel | kick | broadcast }. */

import { waitUntil } from '@vercel/functions';
import { cancelGroup, getGroup, joinGroup, leaveGroup, updateGroup } from '../../_lib/db.js';
import { parseBroadcast, parseMaxMembers, parseUserId, parseVisibility, str } from '../../_lib/validation.js';
import { withAuth, ok, ApiError, bodyOf, codeParam, isUniqueViolation } from '../../_lib/response.js';
import { notifyBroadcast, notifyCancelled, notifyJoin, notifyKicked } from '../../_lib/telegram.js';
import { isActive, type GroupDetail } from '../../../shared/rules.js';

async function load(code: string, userId: number): Promise<GroupDetail> {
  const group = await getGroup(code, userId);
  if (!group) throw new ApiError(404, 'Group not found');
  return group;
}

const LEADER_ONLY = new Set(['cancel', 'kick', 'broadcast']);

/** Friendly pre-checks; the SQL in db.ts is the real guard against races. */
function assertAllowed(action: string, g: GroupDetail, userId: number): void {
  if (!['join', 'leave', ...LEADER_ONLY].includes(action)) {
    throw new ApiError(400, "action must be 'join', 'leave', 'cancel', 'kick' or 'broadcast'");
  }
  if (!isActive(g.status)) throw new ApiError(409, `Group is ${g.status}`);
  const isCreator = g.creatorId === userId;
  if (LEADER_ONLY.has(action) && !isCreator) throw new ApiError(403, `Only the leader can ${action}`);
  if (action === 'join') {
    if (g.joined) throw new ApiError(409, 'Already a member of this group');
    if (g.status === 'full') throw new ApiError(409, 'Group is already full');
  }
  if (action === 'leave') {
    if (isCreator) throw new ApiError(403, 'Leader cannot leave — cancel the group instead');
    if (!g.joined) throw new ApiError(409, 'Not a member of this group');
  }
}

export default withAuth({
  GET: async (req, res, user) => {
    ok(res, await load(codeParam(req), user.id));
  },

  PATCH: async (req, res, user) => {
    const g = await load(codeParam(req), user.id);
    if (g.creatorId !== user.id) throw new ApiError(403, 'Only the leader can update this group');
    if (!isActive(g.status)) throw new ApiError(409, 'Group is no longer open');

    const body = bodyOf(req);
    const patch = {
      ...('maxMembers' in body ? { maxMembers: parseMaxMembers(body.maxMembers) } : {}),
      ...('visibility' in body ? { visibility: parseVisibility(body.visibility) } : {}),
    };
    if (!Object.keys(patch).length) throw new ApiError(400, 'No updatable fields provided');
    if (patch.maxMembers != null && patch.maxMembers < g.currentCount) {
      throw new ApiError(400, `maxMembers cannot be below the current member count (${g.currentCount})`);
    }
    await updateGroup(g.id, patch);
    ok(res, await load(g.code, user.id));
  },

  POST: async (req, res, user) => {
    const body = bodyOf(req);
    const action = str(body.action);
    const g = await load(codeParam(req), user.id);
    assertAllowed(action, g, user.id);

    switch (action) {
      case 'join': {
        let count: number | null;
        try {
          count = await joinGroup(g.id, user.id);
        } catch (e) {
          if (isUniqueViolation(e)) throw new ApiError(409, 'Already a member of this group');
          throw e;
        }
        if (count === null) throw new ApiError(409, 'Group just filled up or closed');
        const updated = await load(g.code, user.id);
        waitUntil(notifyJoin(updated, user.id));
        return ok(res, updated);
      }
      case 'leave':
        if ((await leaveGroup(g.id, user.id)) === null) throw new ApiError(409, 'Not a member of this group');
        break;
      case 'cancel':
        await cancelGroup(g.id);
        waitUntil(notifyCancelled(g));
        break;
      case 'kick': {
        const target = parseUserId(body.userId);
        if (target === g.creatorId) throw new ApiError(400, 'Leader cannot remove themselves');
        if ((await leaveGroup(g.id, target)) === null) throw new ApiError(409, 'Not a member of this group');
        waitUntil(notifyKicked(g, target));
        break;
      }
      case 'broadcast':
        waitUntil(notifyBroadcast(g, parseBroadcast(body.message)));
        break;
    }
    ok(res, await load(g.code, user.id));
  },
});
