/** Entry: Telegram UI styles, dev mock, SDK init, then render (EnvUnsupported if the client can't run us). */

// Include Telegram UI styles first to allow our code override the package CSS.
import '@telegram-apps/telegram-ui/dist/styles.css';

import ReactDOM from 'react-dom/client';
import { StrictMode } from 'react';
import { retrieveLaunchParams } from '@tma.js/sdk-react';

import { App } from '@/app/App.tsx';
import { ErrorBoundary } from '@/app/ErrorBoundary.tsx';
import { EnvUnsupported } from '@/app/EnvUnsupported.tsx';
import { init } from '@/app/init.ts';

import './index.css';

// Mock the environment in case, we are outside Telegram.
import './app/mockEnv.ts';

const root = ReactDOM.createRoot(document.getElementById('root')!);

try {
  const launchParams = retrieveLaunchParams();
  const { tgWebAppPlatform: platform } = launchParams;
  const startParam = launchParams.tgWebAppStartParam || '';
  const debug = startParam.includes('debug') || import.meta.env.DEV;

  // Configure all application dependencies.
  init({
    debug,
    eruda: debug && ['ios', 'android'].includes(platform),
    mockForMacOS: platform === 'macos',
  });

  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App/>
      </ErrorBoundary>
    </StrictMode>,
  );
} catch {
  root.render(<EnvUnsupported/>);
}
