import { AuthKitProvider } from '@workos-inc/authkit-react';
import { CloudApp } from './CloudApp';
import { authKitConfig, followReturnTo } from './authConfig';

export function CloudRoot({ clientId }: { clientId: string }) {
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
