import { describe, expect, it } from 'vitest';
import { assessBrowserDevice, featureAllowed } from './profile';

describe('BR64-02 capability detection', () => {
  it('returns bounded, versioned feature assessments without device category assumptions', async () => {
    const profile = await assessBrowserDevice();
    expect(profile.schema_version).toBe(1);
    expect(profile.probe.bounded).toBe(true);
    expect(Object.keys(profile.features)).toContain('render');
    expect(Object.values(profile.features).every((value) =>
      ['available', 'degraded', 'unsupported_here', 'unverified'].includes(value.decision))).toBe(true);
    expect(typeof featureAllowed(profile, 'render')).toBe('boolean');
  });
  it('does not claim WebGPU models or physical audio output are proven', async () => {
    const profile = await assessBrowserDevice();
    expect(profile.features.webgpu_model.decision).not.toBe('available');
    expect(profile.features.output_selection.decision).not.toBe('available');
  });
  it('checks abort signal before probing long-running hardware', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(assessBrowserDevice(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
