import { AuthKitProvider } from '@workos-inc/authkit-react';
import { CloudApp } from './CloudApp';

export function CloudRoot({ clientId }: { clientId: string }) {
  return (
    <AuthKitProvider
      clientId={clientId}
      apiHostname={import.meta.env.VITE_WORKOS_API_HOSTNAME || undefined}
    >
      <CloudApp />
    </AuthKitProvider>
  );
}
