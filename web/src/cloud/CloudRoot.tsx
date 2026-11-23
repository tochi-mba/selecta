import { AuthKitProvider } from '@workos-inc/authkit-react';
import { useEffect } from 'react';
import { CloudApp } from './CloudApp';
import { authKitConfig, followReturnTo } from './authConfig';
import { noteSessionEnded } from './authTrail';
import { BrandMark } from '../ui/BrandMark';
import { persistAfterFirstImport } from './persistence';

export function CloudRoot({ clientId }: { clientId: string }) {
  // The first finished import asks the browser to keep SelectaDJ's details (plan W5b).
  useEffect(() => persistAfterFirstImport(), []);
  const config = authKitConfig(import.meta.env);
  if ('error' in config) {
    return <main className="cloud-runtime-message"><BrandMark className="cloud-mark" /><h1>Cloud sign-in needs configuration</h1><p>{config.error}</p></main>;
  }
  return (
    <AuthKitProvider
      clientId={clientId}
      apiHostname={config.apiHostname}
      devMode={config.devMode}
      onRedirectCallback={({ state }) => followReturnTo(state)}
      // the only real sign-out: AuthKit could not renew the session and removed it (authTrail.ts)
      onRefreshFailure={() => noteSessionEnded()}
    >
      <CloudApp />
    </AuthKitProvider>
  );
}
