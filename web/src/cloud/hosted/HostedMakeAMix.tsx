import { useState, type ReactNode } from 'react';
import type { Api } from '../api';
import { HostedMix } from './HostedMix';

export { footerWords } from './hostedWords';

/** Make a Mix for a hosted account (cloud.hosted_render): one path. The server-rendered mix is the
 * page; the browser mixer, which mixes music kept on a device as it plays, is one press away at the
 * foot of the card rather than a second way of doing the same thing on the same page. With the
 * flag off the shell shows the browser mixer alone, exactly as before. */
export function HostedMakeAMix({ api, workspaceId, browserMixer, othersPlaying, stopOthers }: {
  api: Api;
  workspaceId: string;
  browserMixer: ReactNode;
  othersPlaying: boolean;
  stopOthers: () => void;
}) {
  const [browser, setBrowser] = useState(false);
  if (browser) {
    return (
      <>
        <p className="page hosted-mix-back"><button type="button" className="link" onClick={() => setBrowser(false)}>Back to your SelectaDJ mix</button></p>
        {browserMixer}
      </>
    );
  }
  return (
    <main className="page" id="main" data-place="hosted-mix">
      <h1 className="display small">Make a Mix</h1>
      <HostedMix api={api} workspaceId={workspaceId} othersPlaying={othersPlaying} stopOthers={stopOthers} onBrowserMixer={() => setBrowser(true)} />
    </main>
  );
}
