/** Fallback shown in outdated or non-Telegram clients. */

import { Placeholder, AppRoot } from '@telegram-apps/telegram-ui';
import { retrieveLaunchParams } from '@tma.js/sdk-react';
import { useMemo } from 'react';

export function EnvUnsupported() {
  const platform = useMemo(() => {
    try {
      return retrieveLaunchParams().tgWebAppPlatform;
    } catch {
      return 'android';
    }
  }, []);

  return (
    <AppRoot
      appearance="light"
      platform={['macos', 'ios'].includes(platform) ? 'ios' : 'base'}
    >
      <Placeholder
        header="Oops"
        description="You are using too old Telegram client to run this application"
      >
        <img
          alt="Telegram sticker"
          src="https://xelene.me/telegram.gif"
          style={{ display: 'block', width: '144px', height: '144px' }}
        />
      </Placeholder>
    </AppRoot>
  );
}