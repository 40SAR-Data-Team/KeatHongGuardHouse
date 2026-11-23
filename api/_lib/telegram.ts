/** Outbound bot DMs via raw sendMessage. Never throws: a failed DM must not fail the request that caused it. */

import { categoryOf, type GroupDetail } from '../../shared/rules.js';
import { formatExpiry, inviteLink, memberName } from '../../shared/format.js';

const INVITE_LINK_BASE = process.env.VITE_INVITE_LINK_BASE || 'https://t.me/keat_hong_guard_house_bot/app';

type Button = { text: string; url: string } | { text: string; callback_data: string };

async function sendMessage(chatId: number, text: string, buttons: Button[]): Promise<void> {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: buttons.map((b) => [b]) } }),
    });
    if (!res.ok) console.warn(`[telegram] DM to ${chatId} failed: ${res.status} ${await res.text().catch(() => '')}`);
  } catch (e) {
    console.warn(`[telegram] DM to ${chatId} threw`, e);
  }
}

const BATCH = 25; // Telegram allows ~30 msg/s per bot; stay under it.

// ponytail: 25 msg/s fits ~7,500 recipients in a 300s function; move to a queue past that.
async function sendAll(chatIds: number[], text: string, buttons: Button[]): Promise<void> {
  for (let i = 0; i < chatIds.length; i += BATCH) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    await Promise.all(chatIds.slice(i, i + BATCH).map((id) => sendMessage(id, text, buttons)));
  }
}

const viewButton = (code: string): Button => ({ text: 'View group', url: inviteLink(INVITE_LINK_BASE, code) });

/** t.me link when the user has a username, tg://user otherwise (works inside Telegram). */
function chatButton(text: string, userId: number, username: string | null): Button {
  return { text, url: username ? `https://t.me/${username}` : `tg://user?id=${userId}` };
}

const slots = (g: GroupDetail) => (g.maxMembers === null ? `${g.currentCount} joined` : `${g.currentCount}/${g.maxMembers}`);
const leaderOf = (g: GroupDetail) => memberName(g.creatorFirstName, g.creatorUsername);
/** Member ids minus the given ones. */
const membersExcept = (g: GroupDetail, ...skip: number[]) => g.members.map((m) => m.userId).filter((id) => !skip.includes(id));

export function notifyNewGroup(chatIds: number[], g: GroupDetail): Promise<void> {
  const c = categoryOf(g.category);
  const text = `${c.emoji} New ${c.label} group: ${g.title}\nLeader: ${leaderOf(g)}\nCloses ${formatExpiry(g.expiresAt)}`;
  return sendAll(chatIds, text, [viewButton(g.code), { text: `🔕 Mute ${c.label} alerts`, callback_data: `mute:${c.id}` }]);
}

/** On every join: the joiner is pointed at the leader, the leader learns who joined, and on fill everyone else hears it. */
export function notifyJoin(g: GroupDetail, joinerId: number): Promise<unknown> {
  const joiner = g.members.find((m) => m.userId === joinerId);
  if (!joiner) return Promise.resolve();
  const leader = leaderOf(g);
  const joinerName = memberName(joiner.firstName, joiner.username);
  const isFull = g.status === 'full';
  const full = isFull ? '\nThe group is now full.' : '';
  // Notes go in the text, not a button: a malformed URL in a button rejects the whole message.
  const notes = g.description ? `\n\n📝 ${g.description}` : '';

  return Promise.all([
    sendMessage(joinerId,
      `✅ You joined "${g.title}" (${slots(g)}).\nYour leader is ${leader}. Message them to coordinate.${notes}${full}`,
      [chatButton(`Message ${leader}`, g.creatorId, g.creatorUsername), viewButton(g.code)]),
    sendMessage(g.creatorId,
      `👋 ${joinerName} joined "${g.title}" (${slots(g)}).${full}`,
      [chatButton(`Message ${joinerName}`, joiner.userId, joiner.username), viewButton(g.code)]),
    isFull ? sendAll(membersExcept(g, joinerId, g.creatorId), `🎉 "${g.title}" is now full (${slots(g)}).`, [viewButton(g.code)]) : null,
  ]);
}

export function notifyCancelled(g: GroupDetail): Promise<void> {
  return sendAll(membersExcept(g, g.creatorId), `❌ ${leaderOf(g)} cancelled "${g.title}".`, []);
}

/** Leader's message to every other member. */
export function notifyBroadcast(g: GroupDetail, message: string): Promise<void> {
  return sendAll(membersExcept(g, g.creatorId), `📣 ${leaderOf(g)} in "${g.title}":\n\n${message}`,
    [chatButton(`Reply to ${leaderOf(g)}`, g.creatorId, g.creatorUsername), viewButton(g.code)]);
}

export function notifyKicked(g: GroupDetail, userId: number): Promise<void> {
  return sendMessage(userId, `🚪 ${leaderOf(g)} removed you from "${g.title}".`, []);
}

