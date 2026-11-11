import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import { Listening } from './Listening';

/** SF-0240-05: nothing on a blind comparison's screen tells the two versions apart except their
 * neutral letters. The server's public study list carries only trial ids
 * (tests/test_ex_0129_study_integrity.py); this holds the page to the same rule even if a server ever
 * sent more, and checks the two versions are drawn identically. */

const LEAKS = ['method-bass-swap', 'renderer-v2', 'arm-treatment', 'arm-control', 'New engine', 'renderer-baseline'];

const open = async () => {
  fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'neutral' } });
  fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'ear' } });
  fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
  await screen.findByText(/Comparison \d+ of/);
};

/** Every piece of text and every attribute value under a node. */
const surface = (root: Element) => [
  root.textContent ?? '',
  ...[root, ...root.querySelectorAll('*')].flatMap((node) => [...node.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)),
].join('\n');

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('SF-0240-05 blind comparison neutrality', () => {
  it('shows no method, renderer or condition, even if the server were to send one', async () => {
    fakeBackend({
      'GET /listening': [{ id: 't1', method: 'method-bass-swap', a: { renderer: 'renderer-v2', condition: 'arm-treatment' }, b: { renderer: 'renderer-baseline', condition: 'arm-control', label: 'New engine' } }],
    });
    const { container } = render(<Listening />);
    await open();
    const text = surface(container);
    for (const leak of LEAKS) expect(text).not.toContain(leak);
    // the clips are addressed by trial and letter only
    const sources = [...container.querySelectorAll('audio')].map((audio) => audio.getAttribute('src'));
    expect(sources).toEqual(['/api/listening/t1/a/audio', '/api/listening/t1/b/audio']);
  });

  it('draws Version A and Version B the same way: same parts, same order, same classes, differing only by letter', async () => {
    fakeBackend({ 'GET /listening': [{ id: 't1' }] });
    const { container } = render(<Listening />);
    await open();
    const [a, b] = [...container.querySelectorAll('.study-version')];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    const neutral = (node: Element, letter: string) => node.outerHTML
      .replaceAll(`/${letter.toLowerCase()}/`, '/X/')
      .replace(new RegExp(`\\b${letter}\\b`, 'g'), 'X')
      .replace(/_r_[0-9a-z]+_/g, 'ID');
    expect(neutral(a, 'A')).toBe(neutral(b, 'B'));
    // neither is singled out as first choice, recommended or new
    expect(container.querySelectorAll('.study-version .primary, .study-version [aria-current]')).toHaveLength(0);
    const choices = [...container.querySelectorAll('.study-choices button')].map((button) => button.className);
    expect(choices[0]).toBe(choices[1]);
  });
});
