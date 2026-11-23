/** GET /api/groups: visible live groups (`?mine=1`: the caller's). POST: create a group and DM matching subscribers. */

import { waitUntil } from '@vercel/functions';
import {
  countActiveGroups, getGroup, getUserTags, insertGroup, isCodeTaken, listMyGroups, listPublicGroups, listSubscriberIds,
} from '../_lib/db.js';
import { generateUniqueCode } from '../_lib/codegen.js';
import { parseCreateBody } from '../_lib/validation.js';
import { withAuth, ok, ApiError, bodyOf } from '../_lib/response.js';
import { notifyNewGroup } from '../_lib/telegram.js';
import { MAX_ACTIVE_GROUPS } from '../../shared/rules.js';

export default withAuth({
  GET: async (req, res, user) => {
    ok(res, req.query.mine ? await listMyGroups(user.id) : await listPublicGroups(user.id));
  },

  POST: async (req, res, user) => {
    const body = parseCreateBody(bodyOf(req));
    // ponytail: two concurrent creates can exceed the cap by one; move to a DB check if abused.
    if (await countActiveGroups(user.id) >= MAX_ACTIVE_GROUPS) {
      throw new ApiError(429, `You already lead ${MAX_ACTIVE_GROUPS} active groups. Cancel one or wait for it to close.`);
    }
    const have = new Set((await getUserTags(user.id)).map((t) => t.kind));
    const missing = body.audienceKinds.find((k) => !have.has(k));
    if (missing) throw new ApiError(400, `Set your ${missing} tag in Settings before targeting it`);

    const code = await generateUniqueCode(isCodeTaken);
    await insertGroup({ ...body, code, creatorId: user.id });
    const group = (await getGroup(code, user.id))!;

    if (group.visibility === 'public') {
      // Respond now; waitUntil keeps the function alive until every DM is sent.
      waitUntil(listSubscriberIds(group.category, user.id, group.audience)
        .then((ids) => notifyNewGroup(ids, group))
        .catch((e) => console.warn('[telegram] new-group DMs failed', e)));
    }
    ok(res, group);
  },
});
