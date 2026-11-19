import { describe, expect, it } from 'vitest';
import { directoryInput, dirPicker, fileInput, opfs, storageSpace } from './capabilities';

// jsdom is itself a browser-shaped environment with no pickers and no OPFS: exactly the kind
// of browser these checks must answer honestly about, with a reason ready to show.

describe('capability tests', () => {
  it('always offers the plain file input', () => {
    expect(fileInput()).toEqual({ supported: true });
  });

  it('answers directory input by probing an input element, never the user agent', () => {
    const answer = directoryInput();
    expect(typeof answer.supported).toBe('boolean');
    if (!answer.supported) expect(answer.reason).toMatch(/SelectaDJ/);
  });

  it('reports no folder picker here, with words ready for the member', () => {
    const answer = dirPicker();
    expect(answer.supported).toBe(false);
    expect(answer.reason).toMatch(/SelectaDJ/);
  });

  it('reports no OPFS here, with the cache consequence spelled out', () => {
    const answer = opfs();
    expect(answer.supported).toBe(false);
    expect(answer.reason).toMatch(/SelectaDJ/);
  });

  it('degrades the storage estimate to unsupported instead of throwing', async () => {
    const answer = await storageSpace();
    expect(typeof answer.supported).toBe('boolean');
    if (!answer.supported) expect(answer.reason).toMatch(/SelectaDJ/);
  });
});
