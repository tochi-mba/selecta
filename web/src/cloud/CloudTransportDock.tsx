import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlayingBar } from '../devices/PlayingBar';
import type { Speaker } from '../devices/usePlaybackDevice';
import { Account, Api, featureOn, Page } from './api';
import { catalogueSource } from './cloudCatalogue';
import { claimFocus, clearNotice, releaseFocus, shareLibraryPlayer, useTransport } from './cloudTransport';
import { recoveringSpeaker } from './recoveringSpeaker';
import { useCloudPlayer } from './useCloudPlayer';

// The one Cloud player (ADR-0419, flag `cloud.single_audio_owner`). CloudApp mounts this dock
// above the pages, so the Library's song player and this browser as the session's speaker keep
// playing while the person moves between pages (AV-0419-02). Starting either one pauses the
// other and nothing resumes on its own (AV-0419-03, see cloudTransport.ts). The speaker joins
// the dock the first time Listen is opened in this tab, as the bar did before, and then stays.

export const SINGLE_AUDIO_OWNER = 'cloud.single_audio_owner';

export function singleAudioOwner(account: Pick<Account, 'features'> | null) {
  return featureOn(account, SINGLE_AUDIO_OWNER);
}

export function CloudTransportDock({ api, account, page, reload = 0 }: { api: Api; account: Account; page: Page; reload?: number }) {
  const workspaceId = account.workspace.id;
  const audioRef = useRef<HTMLAudioElement>(null);
  const deviceBox = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [deviceProblem, setDeviceProblem] = useState('');
  const [armed, setArmed] = useState(page === 'listen');
  const player = useCloudPlayer({ api, workspaceId, audio: audioRef, setError, skipOnFailure: true });
  const transport = useTransport();

  useEffect(() => { if (page === 'listen') setArmed(true); }, [page]);
  // The Library page plays through this dock's player rather than its own element.
  useEffect(() => { shareLibraryPlayer(workspaceId, player); });
  useEffect(() => () => { shareLibraryPlayer(null, null); releaseFocus('library'); releaseFocus('device'); }, [workspaceId]);

  const library = useMemo(() => catalogueSource(api, workspaceId), [api, workspaceId]);
  useEffect(() => { if (reload) library.catalogue.refresh(); }, [library, reload]);
  const speakerFor = useCallback((audio: HTMLAudioElement, source: (index: number) => Promise<string | null>): Speaker => (
    recoveringSpeaker(audio, source, { onProblem: setDeviceProblem, songName: library.name })
  ), [library]);

  // The speaker's element lives inside PlayingBar; media events don't bubble, but they do pass
  // through ancestors while capturing, so the dock hears the speaker start without reaching in.
  useEffect(() => {
    const box = deviceBox.current;
    if (!box) return;
    const started = (event: Event) => {
      const element = event.target as HTMLMediaElement;
      // Recovery may play the next song immediately after reporting a failed one.
      // Do not erase that explanation on its automatic `play` event.
      claimFocus({ id: 'device', pause: () => element.pause() });
    };
    // Paused or faded out (the lease moved): it no longer holds the sound.
    const stopped = () => releaseFocus('device');
    box.addEventListener('play', started, true);
    box.addEventListener('pause', stopped, true);
    return () => { box.removeEventListener('play', started, true); box.removeEventListener('pause', stopped, true); };
  }, [armed]);

  const libraryStarted = () => {
    player.heard();
    void player.prefetchNext();
    claimFocus({ id: 'library', pause: () => audioRef.current?.pause() });
  };
  const libraryPaused = () => {
    player.heard();
    releaseFocus('library');
  };
  const libraryEnded = () => {
    if (!player.upNext) releaseFocus('library');
    player.advance();
  };

  const track = player.track;
  const devices = featureOn(account, 'devices');
  const showDevice = devices && armed;
  if (!track && !showDevice && !error) return null;
  return (
    <section className="cloud-transport" aria-label="SelectaDJ player" data-focus={transport.focus ?? 'none'}>
      {showDevice && (
        <div ref={deviceBox}>
          <PlayingBar api={api} workspaceId={workspaceId} source={library.source} songName={library.name}
            remoteControl={account.features['devices.remote_control'] !== false} speakerFor={speakerFor} />
          {deviceProblem && <p className="cloud-feedback error" role="alert">{deviceProblem} <button type="button" onClick={() => setDeviceProblem('')}>Dismiss</button></p>}
        </div>
      )}
      {track && (
        <section className="cloud-card cloud-library-player" aria-label="Player">
          <div>
            <p className="cloud-eyebrow">NOW PLAYING FROM YOUR LIBRARY</p>
            <strong data-testid="now-playing">{track.name}</strong>
            {player.upNext && <p className="cloud-up-next" data-testid="up-next">Up next: {player.upNext.name}{player.bufferedId === player.upNext.id ? ' · loaded' : ''}</p>}
          </div>
          <audio ref={audioRef} controls autoPlay={player.autoplay} src={track.url} data-track={track.id} data-testid="library-audio"
            onLoadedMetadata={player.loaded} onTimeUpdate={player.heard} onPause={libraryPaused} onPlaying={libraryStarted} onPlay={libraryStarted}
            onEnded={libraryEnded} onError={() => void player.refreshUrl()} />
        </section>
      )}
      {error && <p className="cloud-feedback error" role="alert" data-testid="library-player-error">{error}</p>}
      {transport.notice && <p className="cloud-feedback" role="status">{transport.notice} <button type="button" onClick={clearNotice}>OK</button></p>}
    </section>
  );
}
