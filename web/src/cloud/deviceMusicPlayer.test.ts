import { describe, expect, it, vi } from 'vitest';
import { playbackStatusText } from '../copy';
import type { SessionState, SessionView } from '../devices/usePlaybackDevice';
import type { BrowserSpeaker } from '../engine';
import { LocalFirstPlayer, NOTHING_TO_PLAY, nowStateFrom, PlayerActions, PlayerFacts, statusOf } from './deviceMusicPlayer';

const session = (over: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: 'r', song_index: 1, offset_ms: 30_000, anchor_at: 100, state: 'playing',
  active_device_id: 'other', lease_expires_at: 200, seq: 3, fence: 2, state_confidence: 'fresh', ...over,
});
const view = (over: Partial<SessionView> = {}, s: Partial<SessionState> = {}): SessionView => ({
  session: session(s), speaker: 'elsewhere', speaker_device_id: 'other', speaker_name: 'Laptop', ask_before_playing_here: true, server_time: 110, ...over,
});
const facts = (over: Partial<PlayerFacts> = {}): PlayerFacts => ({
  mix: [{ duration: 200 }, { duration: 180 }, { duration: 240 }], view: null, speaking: false, here: null,
  engine: null, refusal: null, serverNow: 110, said: '', ...over,
});
const SOUND = { volume: 1, muted: false };

describe('the local-first player tells the truth (ADR-0457/0460/0461)', () => {
  it('is idle with nothing playing anywhere', () => {
    const now = nowStateFrom(facts(), SOUND);
    expect(now.phase).toBe('idle');
    expect(now.notice).toBe('');
  });

  it('follows a fresh speaker elsewhere from the server clock', () => {
    const now = nowStateFrom(facts({ view: view() }), SOUND);
    expect(now.phase).toBe('playing');
    expect(now.position).toBe(1);
    expect(now.songTime).toBe(40);
    expect(now.duration).toBe(180);
  });

  it('never calls a lapsed speaker playing', () => {
    const lapsed = facts({ view: view({}, { state_confidence: 'uncertain' }) });
    const now = nowStateFrom(lapsed, SOUND);
    expect(now.phase).toBe('idle');
    expect(statusOf(lapsed)).toEqual({ state: 'uncertain' });
    expect(now.notice).toBe(playbackStatusText({ state: 'uncertain' }));
  });

  it('playing here is never more than output unverified until a person confirms the sound check', () => {
    const here = facts({
      speaking: true, view: view({ speaker: 'here' }), here: { song_index: 0, offset_ms: 5000, state: 'playing' },
      engine: { phase: 'playing', output: { status: 'output_unverified' }, notice: '' },
    });
    const now = nowStateFrom(here, SOUND);
    expect(now.phase).toBe('playing');
    expect(now.songTime).toBe(5);
    expect(statusOf(here)).toEqual({ state: 'output_unverified' });
    const heard = { ...here, engine: { phase: 'playing' as const, output: { status: 'verified_at' as const, at: 1_700_000_000 }, notice: '' } };
    expect(statusOf(heard)).toEqual({ state: 'playing', verifiedAt: 1_700_000_000 });
  });

  it('reports an interrupted engine as interrupted, with the engine’s own sentence', () => {
    const now = nowStateFrom(facts({
      speaking: true, engine: { phase: 'paused', output: { status: 'interrupted' }, notice: 'The sound was interrupted. Press play to carry on.' },
    }), SOUND);
    expect(now.phase).toBe('paused');
    expect(now.notice).toBe('The sound was interrupted. Press play to carry on.');
  });

  it('says why a device cannot play, from the probe', () => {
    const refused = facts({ refusal: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' });
    expect(statusOf(refused)).toEqual({ state: 'unsupported_here', reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' });
    expect(nowStateFrom(refused, SOUND).notice).toContain('cannot mix audio here');
  });

  it('claims no transition, spectrum or seam it does not have', () => {
    const now = nowStateFrom(facts({ view: view() }), SOUND);
    expect(now.inSeam).toBe(false);
    expect(now.nextReady).toBe(false);
    expect(now.lastSeamKey).toBeNull();
  });
});

const actions = (over: Partial<PlayerActions> = {}): PlayerActions => ({
  playHere: vi.fn(async () => ''), command: vi.fn(async () => undefined), remoteControl: true, speaker: null, ...over,
});

describe('the player’s controls', () => {
  it('says there is nothing to play rather than pretending to start', async () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts({ mix: [] }), act);
    const heard = vi.fn();
    player.onChange = heard;
    await player.togglePause();
    expect(act.playHere).not.toHaveBeenCalled();
    expect(player.state.notice).toBe(NOTHING_TO_PLAY);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('takes the lease when this device is not the speaker, starting at the song pressed, with no seek', async () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts({ view: view() }), act);
    await player.playFrom(2, 10);
    expect(act.playHere).toHaveBeenCalledTimes(1);
    // the new speaker begins where the press asked, not where the session last was (song 1, 30 s)
    // an ordinary press does not insist (abdf6bfa added the second argument)
    expect(act.playHere).toHaveBeenCalledWith({ song_index: 2, offset_ms: 10_000 }, undefined);
    expect(act.command).not.toHaveBeenCalled();
  });

  it('starts a new speaker at the top of the song when no offset is given, rounding to whole ms', async () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts(), act);
    await player.playFrom(1);
    expect(act.playHere).toHaveBeenLastCalledWith({ song_index: 1, offset_ms: 0 }, undefined);
    await player.playFrom(0, 1.2504);
    expect(act.playHere).toHaveBeenLastCalledWith({ song_index: 0, offset_ms: 1250 }, undefined);
    expect(act.command).not.toHaveBeenCalled();
  });

  it('seeks through the session when this device is already the speaker', async () => {
    const act = actions();
    const here = facts({ speaking: true, view: view({ speaker: 'here' }), here: { song_index: 0, offset_ms: 0, state: 'playing' },
      engine: { phase: 'playing', output: { status: 'output_unverified' }, notice: '' } });
    const player = new LocalFirstPlayer(here, act);
    await player.playFrom(2, 10);
    expect(act.playHere).not.toHaveBeenCalled();
    expect(act.command).toHaveBeenCalledWith('seek', { song_index: 2, offset_ms: 10_000 });
  });

  it('passes on why taking over did not happen, and does not seek', async () => {
    const act = actions({ playHere: vi.fn(async () => 'Playing on Laptop. Press play again to move it here.') });
    const player = new LocalFirstPlayer(facts(), act);
    await player.playFrom(0);
    expect(act.command).not.toHaveBeenCalled();
    expect(player.state.notice).toBe('Playing on Laptop. Press play again to move it here.');
  });

  it('pauses a speaker elsewhere by command, not by touching local audio', async () => {
    const act = actions();
    const player = new LocalFirstPlayer(facts({ view: view() }), act);
    await player.togglePause();
    expect(act.command).toHaveBeenCalledWith('pause');
    expect(act.playHere).not.toHaveBeenCalled();
  });

  it('steers its own speaker directly when remote control is off', async () => {
    const speaker = { pause: vi.fn(), resume: vi.fn(), start: vi.fn(async () => undefined), stop: vi.fn() } as unknown as BrowserSpeaker;
    const act = actions({ remoteControl: false, speaker });
    const here = facts({ speaking: true, engine: { phase: 'playing', output: { status: 'output_unverified' }, notice: '' }, here: { song_index: 0, offset_ms: 0, state: 'playing' } });
    const player = new LocalFirstPlayer(here, act);
    await player.togglePause();
    expect(speaker.pause).toHaveBeenCalled();
    expect(act.command).not.toHaveBeenCalled();
  });

  it('volume moves the level shown, and mute remembers the last audible level', () => {
    const player = new LocalFirstPlayer(facts(), actions());
    player.setVolume(0.2);
    expect(player.state.volume).toBe(0.2);
    player.toggleMute();
    expect(player.state.volume).toBe(0);
    expect(player.state.muted).toBe(true);
    player.toggleMute();
    expect(player.state.volume).toBe(0.2);
    expect(player.getSpectrum()).toBeNull();
    expect(player.getVisualTaps()).toBeNull();
  });

  it('only tells its listener when the state really moved', () => {
    const player = new LocalFirstPlayer(facts(), actions());
    const heard = vi.fn();
    player.onChange = heard;
    player.update(facts(), actions());
    expect(heard).not.toHaveBeenCalled();
    player.update(facts({ view: view() }), actions());
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('planned transitions on the runtime (BF-0459-04)', () => {
  const schedule = { implementation: 'x', kind: 'beatmatch' as const, startSeconds: 150, windowSeconds: 8, events: [] };
  const record = (fromIndex: number) => ({ fromIndex, toIndex: fromIndex + 1, sources: { a: 'device' as const, b: 'hosted' as const }, schedule });
  const playingHere = (offsetMs: number, fromIndex = 0) => facts({
    speaking: true, here: { song_index: 0, offset_ms: offsetMs, state: 'playing' },
    engine: { phase: 'playing', output: { status: 'output_unverified' }, notice: '' }, seam: record(fromIndex),
  });

  it('names the seam the engine was handed: ready, where, and while it runs', () => {
    const before = nowStateFrom(playingHere(100_000), SOUND);
    expect(before.nextReady).toBe(true);
    expect(before.seamAt).toBe(150);
    expect(before.inSeam).toBe(false);
    expect(nowStateFrom(playingHere(152_000), SOUND).inSeam).toBe(true);
    expect(nowStateFrom(playingHere(159_000), SOUND).inSeam).toBe(false);
  });

  it('claims no seam for a song it is not out of, or on another device', () => {
    expect(nowStateFrom(playingHere(100_000, 1), SOUND).nextReady).toBe(false);
    const elsewhere = nowStateFrom(facts({ view: view(), seam: record(1) }), SOUND);
    expect(elsewhere.nextReady).toBe(false);
    expect(elsewhere.seamAt).toBeNull();
  });

  it('with the engine clock, shows the hand-over that really plays and its length (T-20261125-37fe)', () => {
    // the engine already plays song 1, which came in 5 s ago over the planned 8 s seam
    const blending = facts({
      speaking: true, here: { song_index: 1, offset_ms: 5_000, state: 'playing' }, mix: [{ duration: 0 }, { duration: 0 }],
      engine: { phase: 'playing', output: { status: 'output_unverified' }, notice: '' }, seam: record(0),
      clock: { length: 180, next: null, entered: { fromIndex: 0, fromAt: 150, fromLength: 200, heard: 5 } },
    });
    const now = nowStateFrom(blending, SOUND);
    expect(now).toMatchObject({ position: 0, songTime: 155, duration: 200, inSeam: true, seamAt: 150, blend: { window: 8, nextLength: 180 } });
    const done = nowStateFrom({ ...blending, here: { song_index: 1, offset_ms: 9_000, state: 'playing' }, clock: { ...blending.clock!, entered: { ...blending.clock!.entered!, heard: 9 } } }, SOUND);
    expect(done).toMatchObject({ position: 1, songTime: 9, duration: 180, inSeam: false });
  });
});

describe('playing offline (cloud.offline_playback)', () => {
  it('a volume set here while offline wins over the session’s last word until it is sent', () => {
    expect(nowStateFrom(facts({ view: view({}, { volume: 80 }), heldVolume: 30 }), SOUND).volume).toBeCloseTo(0.3);
    expect(nowStateFrom(facts({ view: view({}, { volume: 80 }), heldVolume: 0 }), SOUND).muted).toBe(true);
    expect(nowStateFrom(facts({ view: view({}, { volume: 80 }), heldVolume: null }), SOUND).volume).toBeCloseTo(0.8);
  });

  it('says why playing offline ended until the next press', () => {
    const player = new LocalFirstPlayer(facts(), actions());
    const heard: string[] = [];
    player.onChange = (now) => heard.push(now.notice);
    player.say('Another device took over while this one was offline, so playback stopped here.');
    expect(heard.at(-1)).toBe('Another device took over while this one was offline, so playback stopped here.');
  });
});
