/** Idempotent bot bootstrap: webhook, commands, menu button, name and descriptions. `bun run telegram:setup`.
 *  Re-run after editing api/_lib/botCopy.ts, rotating TELEGRAM_WEBHOOK_SECRET or changing WEB_APP_URL. */

import {
  BOT_COMMANDS,
  BOT_NAME,
  OPEN_APP_BUTTON_TEXT,
  BOT_DESCRIPTION,
  BOT_SHORT_DESCRIPTION,
} from '../api/_lib/botCopy.ts';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

const botToken = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

/** Returns the env value or throws a fix-it message. */
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is unset. Add it to .env.local (see .env.example).`);
  }
  return value;
}

/** Calls a Bot API method; throws on a non-ok reply so the bot is never left half-configured. */
async function callApi(method: string, payload: unknown): Promise<unknown> {
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown };
  if (!json.ok) throw new Error(`${method} failed: ${JSON.stringify(json)}`);
  console.log(`✓ ${method}`);
  return json.result;
}

async function main(): Promise<void> {
  required(botToken, 'BOT_TOKEN');
  const url = required(webAppUrl, 'WEB_APP_URL');
  const secret = required(secretToken, 'TELEGRAM_WEBHOOK_SECRET');

  // web_app buttons and setWebhook both reject non-https and t.me URLs.
  if (!url.startsWith('https://')) {
    console.error(`✗ WEB_APP_URL must be an https:// URL, got: ${url}`);
    process.exit(1);
  }

  // Only what api/bot.ts handles: commands and the Mute button. Fewer invocations, smaller attack surface.
  await callApi('setWebhook', {
    url: `${url}/api/bot`,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });

  await callApi('setMyCommands', { commands: BOT_COMMANDS });

  // Omitting chat_id sets the DEFAULT menu button for every private chat.
  await callApi('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: OPEN_APP_BUTTON_TEXT,
      web_app: { url },
    },
  });

  await callApi('setMyName', { name: BOT_NAME });
  await callApi('setMyDescription', { description: BOT_DESCRIPTION });
  await callApi('setMyShortDescription', { short_description: BOT_SHORT_DESCRIPTION });

  const info = (await callApi('getWebhookInfo', {})) as {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
  };
  console.log('\nWebhook status:');
  console.log(`  url                  ${info.url}`);
  console.log(`  pending_update_count ${info.pending_update_count}`);
  console.log(`  last_error_message   ${info.last_error_message ?? '(none)'}`);
}

main().catch((e) => {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
