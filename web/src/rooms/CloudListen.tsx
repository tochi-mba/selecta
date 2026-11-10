import { useMemo } from 'react';
import { PlayingBar } from '../devices/PlayingBar';
import type { Api } from '../devices/usePlaybackDevice';
import { RoomPanel } from './RoomPanel';

// Listen in the Cloud app: the "Playing on ..." bar and the host's room panel, ready to drop
// into the Cloud shell as one page. Until Cloud builds mixes, the session's song index is a
// position in the library (oldest first), and each song plays from its prepared playback file.

type Account = { workspace: { id: string }; features: Record<string, boolean>; feature_locks: Record<string, string> };
type AssetPage = { assets: { id: string; name: string }[]; next_cursor: string | null };
type Proxy = { status: string; url?: string };

export function librarySource(api: Api, workspaceId: string) {
  let assets: { id: string; name: string }[] | null = null;
  const list = async () => {
    if (!assets) assets = (await api<AssetPage>('/assets?limit=200', {}, workspaceId)).assets.slice().reverse();
    return assets;
  };
  const source = async (index: number): Promise<string | null> => {
    const asset = (await list())[index];
    if (!asset) return null;
    const path = `/assets/${encodeURIComponent(asset.id)}/playback-proxy`;
    let result = await api<Proxy>(path, { method: 'POST' }, workspaceId);
    for (let tries = 0; result.status !== 'ready' && tries < 200; tries++) {
      if (['failed', 'cancelled', 'quarantined', 'not_requested'].includes(result.status)) return null;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      result = await api<Proxy>(path, {}, workspaceId);
    }
    return result.url ?? null;
  };
  const name = (index: number) => assets?.[index]?.name ?? null;
  return { source, name };
}

export function CloudListen({ api, account }: { api: Api; account: Account }) {
  const workspaceId = account.workspace.id;
  const library = useMemo(() => librarySource(api, workspaceId), [api, workspaceId]);
  const roomsHidden = account.features.rooms === false && !account.feature_locks.rooms;
  const devices = account.features.devices !== false;
  return (
    <div className="cloud-listen">
      {devices && <PlayingBar api={api} workspaceId={workspaceId} source={library.source} songName={library.name} remoteControl={account.features['devices.remote_control'] !== false} />}
      {!roomsHidden && (
        <RoomPanel
          api={api}
          workspaceId={workspaceId}
          locked={account.feature_locks.rooms}
          votesOn={account.features['rooms.votes'] !== false}
          displayOn={account.features['rooms.display'] !== false}
          playHereOn={devices}
        />
      )}
    </div>
  );
}
