/**
 * @fileoverview Drizzle DB client and all group/user queries.
 * Reads POSTGRES_URL from the environment (auto-wired by Vercel).
 * Schema is managed via `bun run db:push` (see drizzle.config.ts), not at runtime.
 */

import { sql as vercelSql } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import { and, eq, getTableColumns, gt, inArray, ne, notExists, or, sql } from 'drizzle-orm';
import { groups, groupAudience, groupMembers, mutedCategories, userTags, users } from './_schema.js';
import {
  CATEGORY_IDS, statusOf, tagKey, type Category, type Group, type GroupDetail, type GroupVisibility, type Tag, type TagKind,
} from '../shared/rules.js';

export const db = drizzle(vercelSql, { schema: { groups, groupAudience, groupMembers, mutedCategories, userTags, users } });

type GroupRow = typeof groups.$inferSelect & {
  creatorFirstName: string;
  creatorUsername: string | null;
  joined: boolean;
};

function toGroup(row: GroupRow): Group {
  return {
    ...row,
    category: row.category as Category,
    expiresAt: row.expiresAt.toISOString(),
    status: statusOf(row),
  };
}

const isMember = (userId: number) =>
  sql<boolean>`exists (select 1 from ${groupMembers} where ${groupMembers.groupId} = ${groups.id} and ${groupMembers.userId} = ${userId})`;

/** True when `userId` holds every audience tag of the group (vacuously true with no audience). */
const eligibleFor = (userId: number) => sql<boolean>`not exists (
  select 1 from ${groupAudience} where ${groupAudience.groupId} = ${groups.id}
    and not exists (select 1 from ${userTags} where ${userTags.userId} = ${userId}
      and ${userTags.kind} = ${groupAudience.kind} and ${userTags.key} = ${groupAudience.key}))`;

/** Group columns + creator name + whether `userId` is a member. */
function groupSelect(userId: number) {
  return db
    .select({
      ...getTableColumns(groups),
      creatorFirstName: users.firstName,
      creatorUsername: users.username,
      joined: isMember(userId),
    })
    .from(groups)
    .innerJoin(users, eq(users.telegramId, groups.creatorId));
}

const notCancelled = eq(groups.cancelled, false);

/** Public groups the user may see (audience tags matched) that are still live, soonest expiry first. */
export async function listPublicGroups(userId: number): Promise<Group[]> {
  const rows = await groupSelect(userId)
    .where(and(notCancelled, eq(groups.visibility, 'public'), gt(groups.expiresAt, sql`now()`), eligibleFor(userId)))
    .orderBy(groups.expiresAt);
  return rows.map(toGroup);
}

/** Groups the user belongs to (created or joined), including ones expired in the last day. */
export async function listMyGroups(userId: number): Promise<Group[]> {
  const rows = await groupSelect(userId)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(notCancelled, gt(groups.expiresAt, sql`now() - interval '1 day'`)))
    .orderBy(sql`${groups.expiresAt} desc`);
  return rows.map(toGroup);
}

export async function getGroup(code: string, userId: number): Promise<GroupDetail | null> {
  // Members keep access; everyone else needs every audience tag (null = 404, same as a missing group).
  const [row] = await groupSelect(userId)
    .where(and(eq(groups.code, code.toUpperCase()), or(isMember(userId), eligibleFor(userId))));
  if (!row) return null;
  const members = await db
    .select({ userId: groupMembers.userId, firstName: users.firstName, username: users.username })
    .from(groupMembers)
    .innerJoin(users, eq(users.telegramId, groupMembers.userId))
    .where(eq(groupMembers.groupId, row.id))
    .orderBy(groupMembers.joinedAt);
  const audience = (await db
    .select({ kind: groupAudience.kind, key: groupAudience.key })
    .from(groupAudience)
    .where(eq(groupAudience.groupId, row.id))) as GroupDetail['audience'];
  return { ...toGroup(row), members, audience };
}

export async function isCodeTaken(code: string): Promise<boolean> {
  const rows = await db.select({ id: groups.id }).from(groups).where(eq(groups.code, code)).limit(1);
  return rows.length > 0;
}

/**
 * Inserts a group and its creator as first member in one statement (writable
 * CTEs) — the Neon HTTP driver has no interactive transactions.
 */
export async function insertGroup(v: {
  code: string; creatorId: number; category: Category; title: string; description: string;
  maxMembers: number | null; expiryMinutes: number; visibility: GroupVisibility;
  /** Kinds of the creator's own tags to use as the audience. Empty = everyone. */
  audienceKinds: TagKind[];
}): Promise<void> {
  const newGroup = db.$with('new_group').as(
    db.insert(groups).values({
      code: v.code, creatorId: v.creatorId, category: v.category, title: v.title,
      description: v.description, maxMembers: v.maxMembers, visibility: v.visibility,
      expiresAt: sql`now() + make_interval(mins => ${v.expiryMinutes})`,
    }).returning(),
  );
  const firstMember = db.$with('first_member').as(
    db.insert(groupMembers).select(
      db.select({ groupId: newGroup.id, userId: newGroup.creatorId, joinedAt: sql`now()`.as('joined_at') }).from(newGroup),
    ),
  );
  if (!v.audienceKinds.length) {
    await db.with(newGroup, firstMember).select().from(newGroup);
    return;
  }
  const audience = db.$with('audience').as(
    db.insert(groupAudience).select(
      db.select({ groupId: newGroup.id, kind: userTags.kind, key: userTags.key })
        .from(newGroup)
        .innerJoin(userTags, eq(userTags.userId, newGroup.creatorId))
        .where(inArray(userTags.kind, v.audienceKinds)),
    ),
  );
  await db.with(newGroup, firstMember, audience).select().from(newGroup);
}

/**
 * Atomically joins: the UPDATE row-locks the group and re-checks the cap on the
 * latest row version, so concurrent joins can't overfill. A duplicate member
 * fails the PK and rolls the whole statement back.
 *
 * @returns The new member count, or null if the group isn't joinable.
 */
export async function joinGroup(groupId: number, userId: number): Promise<number | null> {
  const result = await db.execute<{ current_count: number }>(sql`
    with g as (
      update ${groups} set current_count = current_count + 1
      where id = ${groupId} and not cancelled and expires_at > now()
        and (max_members is null or current_count < max_members)
      returning id, current_count
    ), m as (
      insert into ${groupMembers} (group_id, user_id) select id, ${userId} from g
    )
    select current_count from g`);
  return result.rows[0]?.current_count ?? null;
}

/** @returns The new member count, or null if the user wasn't a member. */
export async function leaveGroup(groupId: number, userId: number): Promise<number | null> {
  const result = await db.execute<{ current_count: number }>(sql`
    with d as (
      delete from ${groupMembers} where group_id = ${groupId} and user_id = ${userId} returning group_id
    )
    update ${groups} set current_count = current_count - 1
    from d where ${groups.id} = d.group_id
    returning current_count`);
  return result.rows[0]?.current_count ?? null;
}

export async function cancelGroup(groupId: number): Promise<void> {
  await db.update(groups).set({ cancelled: true }).where(eq(groups.id, groupId));
}

export async function updateGroup(groupId: number, patch: { maxMembers?: number | null; visibility?: GroupVisibility }) {
  await db.update(groups).set(patch).where(eq(groups.id, groupId));
}

export async function upsertUser(telegramId: number, username: string | null, firstName: string): Promise<void> {
  await db
    .insert(users)
    .values({ telegramId, username, firstName })
    .onConflictDoUpdate({ target: users.telegramId, set: { username, firstName } });
}

export async function getNotifySettings(userId: number): Promise<{ notify: boolean; subscriptions: Category[] }> {
  const [user] = await db.select({ notify: users.notify }).from(users).where(eq(users.telegramId, userId));
  const muted = await db.select({ category: mutedCategories.category }).from(mutedCategories).where(eq(mutedCategories.userId, userId));
  const mutedSet = new Set(muted.map((r) => r.category));
  return { notify: user?.notify ?? true, subscriptions: CATEGORY_IDS.filter((c) => !mutedSet.has(c)) };
}

export async function setNotify(userId: number, notify: boolean): Promise<void> {
  await db.update(users).set({ notify }).where(eq(users.telegramId, userId));
}

/** Replaces the user's category set (stored as the complement: muted categories). */
export async function setSubscriptions(userId: number, categories: Category[]): Promise<void> {
  const muted = CATEGORY_IDS.filter((c) => !categories.includes(c));
  await db.delete(mutedCategories).where(eq(mutedCategories.userId, userId));
  if (muted.length) {
    await db.insert(mutedCategories).values(muted.map((category) => ({ userId, category })));
  }
}

export async function getUserTags(userId: number): Promise<Tag[]> {
  return (await db
    .select({ kind: userTags.kind, key: userTags.key, label: userTags.label })
    .from(userTags)
    .where(eq(userTags.userId, userId))) as Tag[];
}

/**
 * Sets (or clears, with null) the user's tag of one kind. The label is canonicalised:
 * if anyone already holds this kind+key, their spelling is reused, so variants never fork a tag.
 */
export async function setUserTag(userId: number, kind: TagKind, label: string | null): Promise<void> {
  if (label === null) {
    await db.delete(userTags).where(and(eq(userTags.userId, userId), eq(userTags.kind, kind)));
    return;
  }
  const key = tagKey(label);
  const canon = sql`coalesce((select min(${userTags.label}) from ${userTags} where ${userTags.kind} = ${kind} and ${userTags.key} = ${key}), ${label.trim()})`;
  await db
    .insert(userTags)
    .values({ userId, kind, key, label: canon })
    .onConflictDoUpdate({ target: [userTags.userId, userTags.kind], set: { key, label: canon } });
}

/** Everyone with notifications on who hasn't muted this category and holds every audience tag. */
export async function listSubscriberIds(category: Category, excludeId: number, audience: GroupDetail['audience']): Promise<number[]> {
  const rows = await db
    .select({ userId: users.telegramId })
    .from(users)
    .where(and(
      eq(users.notify, true),
      ne(users.telegramId, excludeId),
      // One tag per (user, kind), so "matches all N audience tags" is a count of N.
      audience.length ? sql`(select count(*) from ${userTags} where ${userTags.userId} = ${users.telegramId}
        and (${userTags.kind}, ${userTags.key}) in (${sql.join(audience.map((t) => sql`(${t.kind}, ${t.key})`), sql`, `)})) = ${audience.length}` : undefined,
      notExists(db.select().from(mutedCategories).where(and(
        eq(mutedCategories.userId, users.telegramId), eq(mutedCategories.category, category),
      ))),
    ));
  return rows.map((r) => r.userId);
}
