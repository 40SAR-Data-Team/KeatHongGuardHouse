/** POST /api/bot: grammY webhook. Commands reply with a web_app button; "Mute" buttons on new-group DMs mute that category. */

import { Bot, InlineKeyboard, webhookCallback } from 'grammy';
import { BOT_COMMANDS, COMMAND_REPLIES } from './_lib/botCopy.js';
import { muteCategory } from './_lib/db.js';
import { CATEGORY_IDS, categoryOf, type Category } from '../shared/rules.js';

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
// Not withAuth: updates carry no initData. grammY checks this secret header instead (401 on mismatch).
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

// Fail fast: a misconfigured deploy should 500 loudly, not reply with a broken button.
if (!token) throw new Error('BOT_TOKEN is unset');
if (!webAppUrl) throw new Error('WEB_APP_URL is unset');
if (!secretToken) throw new Error('TELEGRAM_WEBHOOK_SECRET is unset');

const bot = new Bot(token); // botInfo fetched lazily (one getMe per cold start) so it never goes stale.

for (const { command } of BOT_COMMANDS) {
  const { text, button, tab } = COMMAND_REPLIES[command];
  const url = tab ? `${webAppUrl}/?tab=${tab}` : webAppUrl;
  bot.command(command, async (ctx) => {
    // web_app buttons are private-chat only (BUTTON_TYPE_INVALID elsewhere). /start payload is unused: share links are ?startapp=.
    if (ctx.chat.type !== 'private') return;
    await ctx.reply(text, { reply_markup: new InlineKeyboard().webApp(button, url) });
  });
}

/** "Mute <category>" button on new-group DMs. Exported for tests. */
export async function onMute(ctx: { match: RegExpMatchArray | string; from: { id: number }; answerCallbackQuery: (text: string) => Promise<unknown> }) {
  const category = ctx.match[1] as Category;
  if (!CATEGORY_IDS.includes(category)) return ctx.answerCallbackQuery('Unknown category');
  await muteCategory(ctx.from.id, category);
  await ctx.answerCallbackQuery(`Muted ${categoryOf(category).label} alerts. Turn back on in Settings.`);
}
bot.callbackQuery(/^mute:(\w+)$/, onMute);

// Required: an uncaught error becomes a 500 and Telegram retries the update, sending duplicate DMs.
bot.catch((err) => console.error(`[bot] update ${err.ctx.update.update_id} failed:`, err.error));

// 'next-js' adapter: Vercel already parsed req.body, which this adapter reads directly.
export default webhookCallback(bot, 'next-js', { secretToken, onTimeout: 'return', timeoutMilliseconds: 8_000 });
