import { useEffect, useMemo } from 'react';
import { registerBrowserStudioPorts } from './browserPorts';
import { liveBrowserStudioPorts } from './liveBrowserPorts';

/** The production Cloud composition connects real browser-local sources, playback and
 * export on the authenticated workspace. The ports never pass music bytes to Cloud. */
export function LiveBrowserIntegration({ workspaceId }: { workspaceId: string }) {
  const ports = useMemo(() => liveBrowserStudioPorts(workspaceId), [workspaceId]);
  useEffect(() => registerBrowserStudioPorts(ports), [ports]);
  return null;
}
