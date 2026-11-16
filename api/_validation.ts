/**
 * @fileoverview Request-body validators. Limits come from shared/rules.ts so
 * the client form and the server can't disagree.
 */

import { ApiError } from './_response.js';
import {
  CATEGORY_IDS, EXPIRY_MAX, EXPIRY_MIN, MEMBERS_MAX, MEMBERS_MIN, TAG_KIND_IDS, validateDescription, validateTag, validateTitle,
  type Category, type GroupVisibility, type TagKind,
} from '../shared/rules.js';

type Body = Record<string, unknown>;

/** null (no limit) or an integer within MEMBERS_MIN..MEMBERS_MAX. */
export function parseMaxMembers(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < MEMBERS_MIN || n > MEMBERS_MAX) {
    throw new ApiError(400, `maxMembers must be an integer between ${MEMBERS_MIN} and ${MEMBERS_MAX}, or null`);
  }
  return n;
}

/** Defaults to 'public' when absent. */
export function parseVisibility(value: unknown): GroupVisibility {
  const v = value === undefined ? 'public' : String(value);
  if (v !== 'public' && v !== 'private') throw new ApiError(400, "visibility must be 'public' or 'private'");
  return v;
}

export function parseCategory(value: unknown): Category {
  if (!CATEGORY_IDS.includes(value as Category)) {
    throw new ApiError(400, `category must be one of: ${CATEGORY_IDS.join(', ')}`);
  }
  return value as Category;
}

/** Optional list of tag kinds (the creator's own tags of those kinds become the audience). */
export function parseTagKinds(value: unknown): TagKind[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((k) => !TAG_KIND_IDS.includes(k as TagKind))) {
    throw new ApiError(400, `audienceKinds must be an array of: ${TAG_KIND_IDS.join(', ')}`);
  }
  return [...new Set(value as TagKind[])];
}

/** `{ unit?: string | null, … }`: a string sets that kind's tag, null clears it. */
export function parseTagPatch(value: unknown): Partial<Record<TagKind, string | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'tags must be an object');
  const out: Partial<Record<TagKind, string | null>> = {};
  for (const [kind, label] of Object.entries(value)) {
    if (!TAG_KIND_IDS.includes(kind as TagKind)) throw new ApiError(400, `Unknown tag kind: ${kind}`);
    if (label === null) { out[kind as TagKind] = null; continue; }
    const err = typeof label === 'string' ? validateTag(kind as TagKind, label) : 'Tag must be a string or null';
    if (err) throw new ApiError(400, err);
    out[kind as TagKind] = (label as string).trim();
  }
  return out;
}

export function parseCreateBody(body: Body) {
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const err = validateTitle(title) ?? validateDescription(description);
  if (err) throw new ApiError(400, err);

  const expiryMinutes = Number(body.expiryMinutes);
  if (!Number.isInteger(expiryMinutes) || expiryMinutes < EXPIRY_MIN || expiryMinutes > EXPIRY_MAX) {
    throw new ApiError(400, `expiryMinutes must be an integer between ${EXPIRY_MIN} and ${EXPIRY_MAX}`);
  }

  return {
    title,
    description,
    expiryMinutes,
    category: parseCategory(body.category),
    maxMembers: parseMaxMembers(body.maxMembers),
    visibility: parseVisibility(body.visibility),
    audienceKinds: parseTagKinds(body.audienceKinds),
  };
}

export function parseCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'subscriptions must be an array');
  return [...new Set(value.map(parseCategory))];
}
