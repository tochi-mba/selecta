import { describe, expect, it, vi } from 'vitest';
import { browserName, capabilities, deviceKind, IOS_WARNING, isIos, isPoorSpeaker, speakerWarning } from './deviceInfo';
import { holdWakeLock } from './wakeLock';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';

describe('device detection', () => {
  it('knows an iPhone and warns it to keep the screen on', () => {
    const facts = { userAgent: IPHONE, maxTouchPoints: 5, wakeLock: true };
    const caps = capabilities(facts);
    expect(caps).toEqual({ can_play_audio: true, wake_lock: true, ios: true, ios_home_screen: false });
    expect(deviceKind(facts)).toBe('phone');
    expect(isPoorSpeaker('phone', caps)).toBe(true);
    expect(speakerWarning('phone', caps)).toBe(IOS_WARNING);
    expect(browserName(facts)).toBe('Safari on iPhone');
  });

  it('knows an iOS home-screen app', () => {
    const caps = capabilities({ userAgent: IPHONE, standalone: true });
    expect(caps.ios_home_screen).toBe(true);
    expect(isPoorSpeaker('tablet', caps)).toBe(true);
  });

  it('counts a touch-screen Mac as an iPad, and a mouse Mac as a laptop', () => {
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true);
    expect(deviceKind({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe('tablet');
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false);
    expect(deviceKind({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe('laptop');
    const ipad = capabilities({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 });
    expect(isPoorSpeaker('tablet', ipad)).toBe(false);
    expect(speakerWarning('tablet', ipad)).toBe(IOS_WARNING);
  });

  it('gives Android and desktop browsers no warning', () => {
    const android = { userAgent: ANDROID_PHONE, wakeLock: true };
    expect(deviceKind(android)).toBe('phone');
    expect(speakerWarning('phone', capabilities(android))).toBeNull();
    expect(browserName({ userAgent: WINDOWS_EDGE })).toBe('Edge on Windows');
    expect(deviceKind({ userAgent: WINDOWS_EDGE })).toBe('laptop');
  });

  it('says a device without audio can only be a remote', () => {
    expect(speakerWarning('tv', capabilities({ userAgent: 'SmartTV', audio: false }))).toMatch(/only be a remote/);
  });
});

describe('the wake lock', () => {
  function fakeDocument() {
    const listeners = new Set<() => void>();
    return {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      fire: () => listeners.forEach((fn) => fn()),
      listeners,
    };
  }

  it('is asked for, asked for again when the page comes back, and released', async () => {
    const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
    const request = vi.fn(async () => {
      const s = { released: false, release: async () => { s.released = true; } };
      sentinels.push(s);
      return s;
    });
    const doc = fakeDocument();
    const hold = holdWakeLock({ wakeLock: { request } } as unknown as Navigator, doc as unknown as Document);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    sentinels[0].released = true; // the browser drops it when the page is hidden
    doc.fire();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    hold.release();
    expect(doc.listeners.size).toBe(0);
    await Promise.resolve();
    expect(sentinels[1].released).toBe(true);
  });

  it('lets go of a lock that is granted only after it was released', async () => {
    let grant: (s: { released: boolean; release: () => Promise<void> }) => void = () => {};
    const request = vi.fn(() => new Promise<{ released: boolean; release: () => Promise<void> }>((resolve) => { grant = resolve; }));
    const hold = holdWakeLock({ wakeLock: { request } } as unknown as Navigator, fakeDocument() as unknown as Document);
    hold.release();
    const late = { released: false, release: async () => { late.released = true; } };
    grant(late);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.released).toBe(true);
    expect(hold.held()).toBe(false);
  });

  it('does nothing where the browser has no wake lock', () => {
    const doc = fakeDocument();
    const hold = holdWakeLock({} as Navigator, doc as unknown as Document);
    expect(hold.held()).toBe(false);
    hold.release();
  });
});
