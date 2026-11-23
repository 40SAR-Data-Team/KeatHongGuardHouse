/** Invite sharing and open-a-chat helpers. */

import { shareURL, openTelegramLink } from '@tma.js/sdk-react';
import { inviteLink } from '../../shared/format.ts';

/** Configurable via `VITE_INVITE_LINK_BASE` (see `.env.example`). */
const INVITE_LINK_BASE = import.meta.env.VITE_INVITE_LINK_BASE || 'https://t.me/keat_hong_guard_house_bot/app';

/** Copies the invite link then opens Telegram's share sheet. True if copied; throws if both fail. */
export async function shareInvite(code: string, title: string): Promise<boolean> {
  const link = inviteLink(INVITE_LINK_BASE, code);
  const text = `Join "${title}" on KeatHong GuardHouse`;

  const copied = await navigator.clipboard.writeText(link).then(() => true, () => false);
  if (shareURL.isAvailable()) shareURL(link, text);
  else if (!copied) throw new Error('Share unavailable');
  return copied;
}

/** Opens a Telegram DM inside the client rather than bouncing out to a browser. */
export function openUserChat(username: string): void {
  const link = `https://t.me/${username}`;
  if (openTelegramLink.isAvailable()) openTelegramLink(link);
  else window.open(link, '_blank', 'noopener');
}
