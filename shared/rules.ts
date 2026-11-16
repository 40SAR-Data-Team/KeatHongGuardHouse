/**
 * @fileoverview Group rules and shared types, imported by both api/ and src/.
 * Must stay pure TS: no DOM, no import.meta.env, no drizzle runtime.
 */

export const TITLE_MAX = 60;
/** Matches the varchar(500) column in api/_schema.ts. */
export const DESCRIPTION_MAX = 500;
export const EXPIRY_MIN = 15;
export const EXPIRY_MAX = 24 * 60;
export const MEMBERS_MIN = 2;
export const MEMBERS_MAX = 50;

export const CATEGORIES = [
  { id: 'food',   label: 'Food',   emoji: '🍱', defaultExpiry: 60 },
  { id: 'grab',   label: 'Ride',   emoji: '🚗', defaultExpiry: 30 },
  { id: 'gaming', label: 'Gaming', emoji: '🎮', defaultExpiry: 180 },
  { id: 'other',  label: 'Other',  emoji: '✨', defaultExpiry: 360 },
] as const;

export type Category = (typeof CATEGORIES)[number]['id'];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as Category[];

export function categoryOf(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

export const EXPIRY_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h',  value: 60 },
  { label: '3h',  value: 180 },
  { label: '6h',  value: 360 },
  { label: '24h', value: 1440 },
] as const;

/** `null` = no member cap. */
export const MEMBER_PRESETS = [2, 3, 4, 5, 10, null] as const;

/** Profile tags. A user holds at most one value per kind. `role` values are fixed (ROLES). */
export const TAG_KINDS = [
  { id: 'unit',    label: 'Unit' },
  { id: 'company', label: 'Company' },
  { id: 'platoon', label: 'Platoon' },
  { id: 'section', label: 'Section' },
  { id: 'role',    label: 'Role' },
] as const;

export type TagKind = (typeof TAG_KINDS)[number]['id'];

export const TAG_KIND_IDS = TAG_KINDS.map((k) => k.id) as TagKind[];

export const ROLES = ['Commander', 'Trooper'] as const;

export const TAG_MAX = 30;

/** `key` is what matches; `label` is what people see (first spelling wins per kind+key). */
export interface Tag {
  kind: TagKind;
  key: string;
  label: string;
}

/** Case-, accent-, space- and punctuation-insensitive: "Alpha", "ALPHA " and "a-lpha" are one tag. */
export function tagKey(label: string): string {
  return label.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function validateTag(kind: TagKind, label: string): string | null {
  const l = label.trim();
  if (!tagKey(l)) return 'Use letters or numbers';
  if (l.length > TAG_MAX) return `Tags must be ${TAG_MAX} characters or less`;
  if (kind === 'role' && !ROLES.some((r) => tagKey(r) === tagKey(l))) return `Role must be one of: ${ROLES.join(', ')}`;
  return null;
}

export type GroupStatus = 'open' | 'full' | 'expired' | 'cancelled';
export type GroupVisibility = 'public' | 'private';

/** A group as returned by the API. Dates are ISO strings after JSON. */
export interface Group {
  id: number;
  code: string;
  category: Category;
  creatorId: number;
  creatorFirstName: string;
  creatorUsername: string | null;
  title: string;
  /** Free text from the leader: instructions, one or more links. May be ''. */
  description: string;
  maxMembers: number | null;
  currentCount: number;
  expiresAt: string;
  status: GroupStatus;
  visibility: GroupVisibility;
  /** Whether the requesting user is a member (creator included). */
  joined: boolean;
}

export interface GroupMember {
  userId: number;
  firstName: string;
  username: string | null;
}

export interface GroupDetail extends Group {
  members: GroupMember[];
  /** Tags a viewer must ALL hold to see/join this group. Empty = open to everyone. */
  audience: Omit<Tag, 'label'>[];
}

export interface UserProfile {
  id: number;
  firstName: string;
  username: string | null;
  /** Master switch for new-group DMs (default on). */
  notify: boolean;
  /** Categories to be told about (default all). */
  subscriptions: Category[];
  /** The user's own tags, at most one per kind. */
  tags: Tag[];
}

/** Derives display status. Only `cancelled` is stored; the rest is computed. */
export function statusOf(
  g: { cancelled: boolean; expiresAt: Date | string; currentCount: number; maxMembers: number | null },
  now = Date.now(),
): GroupStatus {
  if (g.cancelled) return 'cancelled';
  if (new Date(g.expiresAt).getTime() <= now) return 'expired';
  if (g.maxMembers !== null && g.currentCount >= g.maxMembers) return 'full';
  return 'open';
}

export function isActive(status: GroupStatus): boolean {
  return status === 'open' || status === 'full';
}

/** Returns an error message, or null if valid. Same rules client- and server-side. */
export function validateTitle(title: string): string | null {
  const t = title.trim();
  if (!t) return 'Please enter a name';
  if (t.length > TITLE_MAX) return `Name must be ${TITLE_MAX} characters or less`;
  return null;
}

export function validateDescription(description: string): string | null {
  if (description.trim().length > DESCRIPTION_MAX) return `Notes must be ${DESCRIPTION_MAX} characters or less`;
  return null;
}
