import { describe, expect, it } from 'vitest';
import {
  ENGINE_INSTALL_GUIDE, LOCAL_ENGINE_URL, PERSONAL_FLAG, personalEnabled,
} from './contract';

describe('browser-first personal mode contract', () => {
  it('is opt-in; never changes hosted playback for unflagged accounts', () => {
    expect(PERSONAL_FLAG).toBe('local_first.personal');
    expect(personalEnabled(null)).toBe(false);
    expect(personalEnabled({ features: {} } as never)).toBe(false);
    expect(personalEnabled({ features: { [PERSONAL_FLAG]: false } } as never)).toBe(false);
    expect(personalEnabled({ features: { [PERSONAL_FLAG]: true } } as never)).toBe(true);
  });

  it('keeps the legacy folder-watch compatibility links for hosted accounts', () => {
    expect(new URL(LOCAL_ENGINE_URL).protocol).toMatch(/^https?:$/);
    expect(ENGINE_INSTALL_GUIDE).toBeTruthy();
  });
});
