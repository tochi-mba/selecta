// What this browser is, for registering it as a playback device (ADR-0415).
//
// iPhones and iOS home-screen apps suspend Web Audio when the screen locks, so they make poor
// speakers; Selecta says so plainly and asks for a screen wake lock where the browser has one.
// iPadOS 13+ reports itself as a Mac, so a Mac with a touch screen counts as an iPad.

export type DeviceKind = 'laptop' | 'desktop' | 'phone' | 'tablet' | 'tv';
export type Capabilities = { can_play_audio: boolean; wake_lock: boolean; ios: boolean; ios_home_screen: boolean };
export type BrowserFacts = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean; // navigator.standalone, Safari's home-screen flag
  displayModeStandalone?: boolean; // matchMedia('(display-mode: standalone)')
  wakeLock?: boolean; // 'wakeLock' in navigator
  audio?: boolean; // AudioContext or HTMLAudioElement exists
};

export function isIos(facts: BrowserFacts): boolean {
  if (/iPhone|iPad|iPod/.test(facts.userAgent)) return true;
  return /Macintosh/.test(facts.userAgent) && (facts.maxTouchPoints ?? 0) > 1;
}

export function deviceKind(facts: BrowserFacts): DeviceKind {
  const ua = facts.userAgent;
  if (/SMART-TV|SmartTV|Tizen|Web0S|CrKey|AFT[A-Z]|BRAVIA|GoogleTV/i.test(ua)) return 'tv';
  if (/iPad/.test(ua) || (isIos(facts) && !/iPhone|iPod/.test(ua))) return 'tablet';
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Mobile/.test(ua)) return 'phone';
  if (/Windows NT|Macintosh|CrOS|Linux/.test(ua)) return 'laptop';
  return 'desktop';
}

export function capabilities(facts: BrowserFacts): Capabilities {
  const ios = isIos(facts);
  return {
    can_play_audio: facts.audio ?? true,
    wake_lock: facts.wakeLock ?? false,
    ios,
    ios_home_screen: ios && Boolean(facts.standalone || facts.displayModeStandalone),
  };
}

export function browserName(facts: BrowserFacts): string {
  const ua = facts.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const kind = deviceKind(facts);
  const system = /iPhone/.test(ua) ? 'iPhone'
    : kind === 'tablet' && isIos(facts) ? 'iPad'
      : /Android/.test(ua) ? 'Android'
        : /Windows/.test(ua) ? 'Windows'
          : /Macintosh/.test(ua) ? 'Mac'
            : /CrOS/.test(ua) ? 'ChromeOS'
              : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${browser} on ${system}` : browser;
}

/** iPhones and iOS home-screen apps: good remotes, poor speakers. */
export function isPoorSpeaker(kind: DeviceKind, caps: Capabilities): boolean {
  return !caps.can_play_audio || caps.ios_home_screen || (caps.ios && kind === 'phone');
}

export const IOS_WARNING = 'On iPhone, keep SelectaDJ open with the screen on while it plays.';

/** The plain warning to show before or while this device is the speaker, if any. */
export function speakerWarning(kind: DeviceKind, caps: Capabilities): string | null {
  if (!caps.can_play_audio) return "This device can't play audio, so it can only be a remote.";
  if (caps.ios || caps.ios_home_screen) return IOS_WARNING;
  return null;
}

export function currentFacts(): BrowserFacts {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone,
    displayModeStandalone: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
    wakeLock: 'wakeLock' in nav,
    audio: typeof Audio !== 'undefined' || typeof AudioContext !== 'undefined',
  };
}
