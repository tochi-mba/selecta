import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alternativeCommand, ControllerNotices } from './ControllerNotices';
import { Api, CommandEvent, Notices, openEnvelope, SessionState, Speaker, usePlaybackDevice, verifyEnvelope } from './usePlaybackDevice';

// ADR-0461 protocol on the speaker and the controller: the speaker acts only on an envelope
// signed with its lease key and scoped to it (BF-0461-01), says when a track is not here
// (BF-0461-05), and controllers see held, missed and unavailable presses (BF-0461-04/05).

const KEY = '7f'.repeat(32);
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (text: string) => new Uint8Array(text.match(/../g)!.map((pair) => parseInt(pair, 16)));

async function sign(key: string, text: string): Promise<string> {
  const imported = await crypto.subtle.importKey('raw', fromHex(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(text)));
}

const clock = () => Date.now() / 1000;
const fields = (over: Record<string, unknown> = {}) => ({
  args: {}, command: 'pause', command_id: 'c1', device_id: 'me', expires_at: clock() + 30, fence: 7,
  issued_by: 'phone', seq: 4, v: 1, workspace_id: 'ws', zone_id: null, ...over,
});

async function signedEvent(over: Record<string, unknown> = {}, key = KEY): Promise<CommandEvent> {
  const body = fields(over);
  const envelope = JSON.stringify(body);
  return { device_id: body.device_id as string, command: body.command as string, args: {}, seq: body.seq as number, command_id: body.command_id as string, fence: body.fence as number, expires_at: body.expires_at as number, envelope, signature: await sign(key, envelope) };
}

afterEach(() => cleanup());

describe('verifying a command envelope (BF-0461-01)', () => {
  it('accepts the server-signed text and nothing altered or signed by another key', async () => {
    const event = await signedEvent();
    expect(await verifyEnvelope(KEY, event.envelope!, event.signature)).toBe(true);
    expect(await verifyEnvelope(KEY, event.envelope!.replace('pause', 'play'), event.signature)).toBe(false);
    expect(await verifyEnvelope('00'.repeat(32), event.envelope!, event.signature)).toBe(false);
    expect(await verifyEnvelope(KEY, event.envelope!, null)).toBe(false);
    expect(await verifyEnvelope(KEY, event.envelope!, 'not-hex')).toBe(false);
  });

  it('acts on the signed fields, refuses mis-scoped or unsigned envelopes, and trusts clear fields only without a key', async () => {
    const event = await signedEvent();
    const opened = await openEnvelope({ ...event, command: 'skip', fence: 99 }, KEY, 'ws', 'me');
    expect(opened?.command).toBe('pause');
    expect(opened?.fence).toBe(7);
    expect(await openEnvelope(event, KEY, 'other-ws', 'me')).toBeNull();
    expect(await openEnvelope(event, KEY, 'ws', 'someone-else')).toBeNull();
    expect(await openEnvelope({ ...event, command_id: 'c2' }, KEY, 'ws', 'me')).toBeNull();
    expect(await openEnvelope({ ...event, envelope: undefined }, KEY, 'ws', 'me')).toBeNull();
    expect(await openEnvelope(event, null, 'ws', 'me')).toBe(event);
  });
});

const session = (over: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: 'r1', song_index: 0, offset_ms: 0, anchor_at: clock(), state: 'playing',
  active_device_id: 'me', lease_expires_at: clock() + 60, seq: 4, fence: 7, state_confidence: 'fresh', ...over,
});

function speakerServer(current: () => SessionState) {
  const acks: Record<string, unknown>[] = [];
  const api = (async (path: string, init?: RequestInit) => {
    if (path === '/devices') return { device: { id: 'me', name: 'Tablet', kind: 'tablet', signed_in: true, this_device: true, poor_speaker: false, last_seen_at: 0, warnings: [] }, notice: null };
    if (path === '/playback/reconnect') return { action: 'continue', session: current(), message: null, envelope_key: KEY };
    if (path.startsWith('/playback/session')) return { session: current(), speaker: 'here', speaker_device_id: 'me', speaker_name: 'Tablet', ask_before_playing_here: false, server_time: clock(), envelope_key: KEY };
    if (path === '/playback/heartbeat') return { outcome: 'renewed', session: current(), server_time: clock(), envelope_key: KEY };
    if (path.endsWith('/ack')) { acks.push(JSON.parse(String(init?.body))); return { ack_result: 'applied' }; }
    throw new Error(`unexpected ${path}`);
  }) as Api;
  return { api, acks };
}

const speakerWith = (position: Speaker['position']): Speaker => ({
  start: vi.fn(async () => undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position, active: () => true,
});

describe('the speaker with a lease key', () => {
  it('never acts on or acks a forged envelope, and echoes the signature of a real one', async () => {
    const { api, acks } = speakerServer(() => session({ state: 'paused', seq: 4 }));
    const speaker = speakerWith(() => ({ song_index: 0, offset_ms: 1000, state: 'paused' }));
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
    const forged = await signedEvent({}, '01'.repeat(32));
    await act(async () => { expect(await hook.result.current.handleCommand(forged)).toBeNull(); });
    expect(acks).toEqual([]);
    const real = await signedEvent();
    await act(async () => { expect(await hook.result.current.handleCommand(real)).toBe('applied'); });
    expect(acks).toEqual([{ device_id: 'me', result: 'applied', signature: real.signature }]);
    hook.unmount();
  });

  it('says unavailable_here, naming the song, when it moved to a track it cannot resolve', async () => {
    const track = { song_id: 42, sha256: 'a'.repeat(64) };
    const { api, acks } = speakerServer(() => session({ seq: 5, song_index: 1, programme: [{ song_id: 1, sha256: 'b'.repeat(64) }, track], track }));
    const speaker = speakerWith(() => null);
    const hook = renderHook(() => usePlaybackDevice({ api, workspaceId: 'ws', speaker }));
    await waitFor(() => expect(hook.result.current.isSpeaker()).toBe(true));
    const skip = await signedEvent({ command: 'skip', command_id: 'c9', seq: 5, args: { song_index: 1 } });
    await act(async () => { expect(await hook.result.current.handleCommand(skip)).toBe('unavailable_here'); });
    expect(acks[0]).toMatchObject({ result: 'unavailable_here', song_id: 42, signature: skip.signature });
    hook.unmount();
  });
});

const notices = (over: Partial<Notices> = {}): Notices => ({ missed: [], waiting: [], unavailable: [], ...over });
const press = (id: string, command: string, reason: string) => ({ command_id: id, command, issued_by: 'phone', reason, created_at: 1, expires_at: 2, resolved_at: null }) as Notices['missed'][number];

describe('what controllers are told (BF-0461-04/05)', () => {
  it('lists waiting and missed presses with why they were dropped', () => {
    render(createElement(ControllerNotices, { notices: notices({ waiting: [press('w', 'skip', 'deferred')], missed: [press('a', 'pause', 'expired'), press('b', 'skip', 'superseded')] }), speakerName: 'Bar tablet', session: null, send: vi.fn() }));
    expect(screen.getByTestId('presses-waiting').textContent).toBe('Waiting for Bar tablet to come back: Skip');
    expect(screen.getByTestId('presses-missed').textContent).toContain('Pause (waited too long), Skip (playback moved to another device)');
  });

  it('offers alternatives for a song missing on the speaker and sends the matching command', async () => {
    const send = vi.fn();
    const programme = [{ song_id: 5, sha256: 'a'.repeat(64) }, { song_id: 6, sha256: 'b'.repeat(64) }];
    const current = session({ programme });
    const unavailable = { command_id: 'u', command: 'skip', issued_by: 'phone', acked_at: 1, song_id: 5, alternatives: [
      { song_id: 9, title: 'Copy', artist: 'A', programme_index: null, same_song: true },
      { song_id: 6, title: 'Next', artist: 'B', programme_index: 1, same_song: false },
    ] };
    render(createElement(ControllerNotices, { notices: notices({ unavailable: [unavailable] }), speakerName: 'Bar tablet', session: current, send }));
    expect(screen.getByTestId('unavailable-here').textContent).toContain("Bar tablet doesn't have that song on this device.");
    screen.getByRole('button', { name: 'Copy - A (another copy)' }).click();
    expect(send).toHaveBeenCalledWith('set_programme', { songs: [9, 6], song_index: 0 });
    expect(alternativeCommand(unavailable.alternatives[1], 5, current)).toEqual({ name: 'skip', args: { song_index: 1 } });
    await waitFor(() => expect(screen.queryByTestId('unavailable-here')).toBeNull());
  });

  it('renders nothing when there is nothing to tell', () => {
    const { container } = render(createElement(ControllerNotices, { notices: notices(), speakerName: null, session: null, send: vi.fn() }));
    expect(container.innerHTML).toBe('');
  });
});
