import { AuthKitProvider } from '@workos-inc/authkit-react';
import { useEffect } from 'react';
import { registerBrowserStudioPorts, type BrowserStudioPorts } from './lf-mix-repair/browserPorts';
import { CloudApp } from './CloudApp';
import { authKitConfig, followReturnTo } from './authConfig';

export function CloudRoot({ clientId, browserPorts }: { clientId: string; browserPorts?: BrowserStudioPorts }) {
  // Optional composition hook for Agents 01/02/05; no Cloud audio fallback.
  useEffect(() => browserPorts ? registerBrowserStudioPorts(browserPorts) : undefined, [browserPorts]);
  const config = authKitConfig(import.meta.env);
  if ('error' in config) {
    return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><h1>Cloud sign-in needs configuration</h1><p>{config.error}</p></main>;
  }
  return (
    <AuthKitProvider
      clientId={clientId}
      apiHostname={config.apiHostname}
      devMode={import.meta.env.DEV}
      onRedirectCallback={({ state }) => followReturnTo(state)}
    >
      <CloudApp />
    </AuthKitProvider>
  );
}
