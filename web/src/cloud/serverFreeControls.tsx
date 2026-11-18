import { ReactNode, startTransition, useEffect, useRef, useState } from 'react';
import { useFlags } from '../flags';
import type { NowState } from '../player';
import type { PlayerLike } from '../playerContract';
import { buildServerFreeCommands, SERVER_FREE_SHORTCUTS, type CommandPlace } from '../shell/commands';
import { openGlossary } from '../state/glossaryRequests';
import { prefs, setPrefs, usePrefs } from '../state/prefs';
import { shortcutFor, shortcutsOn, type ShortcutId } from '../state/shortcuts';
import { CommandPalette } from '../ui/CommandPalette';
import { Dialog } from '../ui/controls';
import { GlossaryHost } from '../ui/Glossary';

/** The command palette, the keyboard shortcuts and their help list for a Cloud shell with no
 * SelectaDJ server on this computer (W5's server-free subset). The palette offers this shell's own
 * places, help, the glossary, theme and motion, and, with a player of its own, play/pause and the
 * next song; the keys are SERVER_FREE_SHORTCUTS, and the help list names only those. Search,
 * Request, Undo, Stage and the song lookups reach a local server, so they are never offered here.
 * `app.command_palette` and `app.shortcuts` still decide whether any of it exists. */

const TRANSPORT_KEYS: ReadonlySet<ShortcutId> = new Set<ShortcutId>(['playPause', 'next', 'previous', 'back5', 'forward5', 'mute']);

export function useServerFreeControls({ places, player, now, hasMix, hasNext }: {
  places: readonly CommandPlace[];
  /** The shell's own player; without one the transport keys and commands are not offered. */
  player?: PlayerLike;
  now?: Pick<NowState, 'phase'>;
  hasMix: boolean;
  hasNext: boolean;
}): { onCommands: () => void; onHelp: () => void; overlays: ReactNode } {
  const on = useFlags();
  const preferences = usePrefs();
  const [commanding, setCommanding] = useState(false);
  const [helping, setHelping] = useState(false);
  const live = useRef({ player, hasMix });
  live.current = { player, hasMix };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setHelping(false); setCommanding(false); }
      const shortcut = shortcutFor(event);
      if (!shortcut || !SERVER_FREE_SHORTCUTS.has(shortcut)) return;
      const { player: transport, hasMix: mixed } = live.current;
      if (TRANSPORT_KEYS.has(shortcut) && !transport) return;
      if (shortcut !== 'palette' && !prefs().singleKeys) return;
      switch (shortcut) {
        case 'palette':
          if (!prefs().palette) return;
          event.preventDefault();
          startTransition(() => setCommanding(true));
          break;
        case 'help': setHelping((open) => !open); break;
        case 'playPause':
          event.preventDefault();
          if (mixed) void transport!.togglePause();
          break;
        case 'next': void transport!.next(); break;
        case 'previous': void transport!.previous(); break;
        case 'mute': transport!.toggleMute(); break;
        case 'back5':
        case 'forward5':
          if (transport!.state.phase === 'idle') return;
          void transport!.seek(transport!.state.songTime + (shortcut === 'back5' ? -5 : 5));
          break;
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);

  const commands = commanding ? buildServerFreeCommands({
    places,
    theme: preferences.theme,
    motion: preferences.motion,
    openHelp: () => setHelping(true),
    transport: player ? {
      ready: hasMix,
      playing: now?.phase === 'playing',
      hasNext: hasNext && now?.phase !== 'idle',
      togglePause: () => void player.togglePause(),
      next: () => void player.next(),
    } : undefined,
  }) : [];
  const listed = shortcutsOn().filter((shortcut) => SERVER_FREE_SHORTCUTS.has(shortcut.id)
    && (player || !TRANSPORT_KEYS.has(shortcut.id))
    && (shortcut.id !== 'palette' || preferences.palette));

  const overlays = (
    <>
      {commanding && on('app.command_palette') && <CommandPalette commands={commands} searchSongs={false} onClose={() => setCommanding(false)} />}
      {helping && on('app.shortcuts') && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelping(false)} footer={<>{on('app.glossary') && <button onClick={() => openGlossary()}>Music terms</button>}<button autoFocus data-autofocus onClick={() => setHelping(false)}>Close</button></>}>
          <dl className="keys">
            {listed.map((shortcut) => (
              <div key={shortcut.id}>
                <dt><kbd>{shortcut.keys}</kbd></dt>
                <dd>{shortcut.label}</dd>
              </div>
            ))}
          </dl>
          <div className="row wrap">
            {on('app.command_palette') && (
              <label className="choice">
                <input type="checkbox" checked={preferences.palette} onChange={(event) => setPrefs({ palette: event.target.checked })} />
                Use Ctrl K for search and commands
              </label>
            )}
            <label className="choice">
              <input type="checkbox" checked={preferences.singleKeys} onChange={(event) => setPrefs({ singleKeys: event.target.checked })} />
              Use single-key shortcuts
            </label>
          </div>
        </Dialog>
      )}
      {on('app.glossary') && <GlossaryHost />}
    </>
  );
  return { onCommands: () => startTransition(() => setCommanding(true)), onHelp: () => setHelping(true), overlays };
}
