/** Typed client for /api; sends Telegram initData as `x-init-data`. */

import { initData } from '@tma.js/sdk-react';
import type { Category, Group, GroupDetail, GroupVisibility, TagKind, UserProfile } from '../../shared/rules.ts';

/** Same-origin authed fetch; throws the server's error message on non-2xx. */
async function apiFetch<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const raw = initData.raw();
  if (!raw) throw new Error('Telegram initData not available');

  const res = await fetch(path, {
    method,
    headers: { 'x-init-data': raw, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  let json: T & { error?: string };
  try {
    json = await res.json() as T & { error?: string };
  } catch {
    throw new Error(`HTTP ${res.status}: unexpected response from server`);
  }
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const getGroups = (mine: boolean) => apiFetch<Group[]>(mine ? '/api/groups?mine=1' : '/api/groups');

export const getGroup = (code: string) => apiFetch<GroupDetail>(`/api/groups/${code}`);

export const createGroup = (payload: {
  title: string;
  category: Category;
  description: string;
  maxMembers: number | null;
  expiryMinutes: number;
  audienceKinds: TagKind[];
}) => apiFetch<GroupDetail>('/api/groups', 'POST', payload);

export type GroupAction = 'join' | 'leave' | 'cancel';

/** `extra`: `{ userId }` for kick, `{ message }` for broadcast. */
export const groupAction = (code: string, action: GroupAction | 'kick' | 'broadcast', extra?: object) =>
  apiFetch<GroupDetail>(`/api/groups/${code}`, 'POST', { action, ...extra });

export const updateGroup = (code: string, patch: { maxMembers?: number | null; visibility?: GroupVisibility }) =>
  apiFetch<GroupDetail>(`/api/groups/${code}`, 'PATCH', patch);

export const getMe = () => apiFetch<UserProfile>('/api/users/me');

export const updateMe = (patch: { notify?: boolean; subscriptions?: Category[]; tags?: Partial<Record<TagKind, string | null>> }) =>
  apiFetch<UserProfile>('/api/users/me', 'PATCH', patch);
