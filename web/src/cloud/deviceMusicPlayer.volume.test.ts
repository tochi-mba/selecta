import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState, SessionView } from '../devices/usePlaybackDevice';
import { LocalFirstPlayer, PlayerActions, PlayerFacts, VOLUME_HOLD_MS, VOLUME_SETTLE_MS } from './deviceMusicPlayer';

// Dragging the volume slider on the speaker used to send one `set_volume` per movement, all based
// on the same session sequence: the first was applied, every other was refused as stale ("Something
// changed just then"), and the level jumped back to the first value the session had taken.

const session = (over: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: 'r', song_index: 0, offset_ms: 0, anchor_at: 100, state: 'playing',
  active_device_id: 'here', lease_expires_at: 200, seq: 3, fence: 2, state_confidence: 'fresh', volume: 80, ...over,
});
const view = (s: Partial<SessionState> = {}): SessionView => ({
  session: session(s), speaker: 'here', speaker_device_id: 'here', speaker_name: 'Laptop', ask_before_playing_here: false, server_time: 110,
});
const facts = (over: Partial<PlayerFacts> = {}): PlayerFacts => ({
  mix: [{ duration: 200 }], view: view(), speaking: true, here: { song_index: 0, offset_ms: 0, state: 'playing' },
  engine: null, refusal: null, serverNow: 110, said: '', ...over,
});
const actions = (over: Partial<PlayerActions> = {}): PlayerActions => ({
  playHere: vi.fn(async () => ''), command: vi.fn(async () => undefined), remoteControl: true, speaker: null, ...over,
});

describe('the volume slider on the speaker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends one command for a whole drag, with the level it ended on', () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts(), act);
    for (const level of [0.7, 0.6, 0.5, 0.4]) player.setVolume(level);
    expect(act.command).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VOLUME_SETTLE_MS);
    expect(act.command).toHaveBeenCalledTimes(1);
    expect(act.command).toHaveBeenCalledWith('set_volume', { volume: 40 });
  });

  it('keeps the level chosen here while the session still says the old one', () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts(), act);
    player.update(facts(), act);
    expect(player.state.volume).toBe(0.8);
    player.setVolume(0.4);
    // a redraw before the session has heard: the old 80 must not come back
    player.update(facts(), act);
    expect(player.state.volume).toBe(0.4);
    // the session says it: from here on the session speaks again
    player.update(facts({ view: view({ volume: 40, seq: 4 }) }), act);
    player.update(facts({ view: view({ volume: 65, seq: 5 }) }), act);
    expect(player.state.volume).toBe(0.65);
  });

  it('gives the session its word back when the press never lands', () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts(), act);
    player.setVolume(0.4);
    vi.advanceTimersByTime(VOLUME_HOLD_MS);
    player.update(facts(), act);
    expect(player.state.volume).toBe(0.8);
  });

  it('sends nothing when this device steers its own speaker', () => {
    const act = actions({ remoteControl: false });
    const player = new LocalFirstPlayer(facts({ view: null }), act);
    player.setVolume(0.3);
    vi.advanceTimersByTime(VOLUME_SETTLE_MS);
    expect(act.command).not.toHaveBeenCalled();
    expect(player.state.volume).toBe(0.3);
  });
});
