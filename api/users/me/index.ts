/** GET /api/users/me: profile. PATCH { notify?, subscriptions?: Category[], tags?: { [kind]: string | null } }. */

import { getNotifySettings, getUserTags, setNotify, setSubscriptions, setUserTag } from '../../_lib/db.js';
import { parseCategories, parseTagPatch } from '../../_lib/validation.js';
import { ApiError, bodyOf, withAuth, ok } from '../../_lib/response.js';
import type { TelegramUser } from '../../_lib/auth.js';
import type { TagKind, UserProfile } from '../../../shared/rules.js';

async function profile(user: TelegramUser): Promise<UserProfile> {
  return {
    id: user.id,
    firstName: user.first_name,
    username: user.username ?? null,
    ...(await getNotifySettings(user.id)),
    tags: await getUserTags(user.id),
  };
}

export default withAuth({
  GET: async (_req, res, user) => ok(res, await profile(user)),

  PATCH: async (req, res, user) => {
    const body = bodyOf(req);
    if (body.notify !== undefined) {
      if (typeof body.notify !== 'boolean') throw new ApiError(400, 'notify must be a boolean');
      await setNotify(user.id, body.notify);
    }
    if (body.subscriptions !== undefined) await setSubscriptions(user.id, parseCategories(body.subscriptions));
    if (body.tags !== undefined) {
      for (const [kind, label] of Object.entries(parseTagPatch(body.tags))) await setUserTag(user.id, kind as TagKind, label);
    }
    ok(res, await profile(user));
  },
});
