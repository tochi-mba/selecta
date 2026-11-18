import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, patch } from './dom';

// W3: the guest page redraws its lists on every poll. `patch` keeps the nodes that are still
// there, so the button a guest is on keeps focus, and a kept button runs its newest handler.

afterEach(() => { document.body.innerHTML = ''; });

const list = (items: { key: string; votes: number }[], onVote: (key: string) => void) =>
  h('ul', {}, ...items.map((item) => h('li', { 'data-key': item.key }, item.key, h('button', { type: 'button', 'aria-label': `Vote ${item.key}`, onclick: () => onVote(`${item.key}:${item.votes}`) }, `${item.votes}`))));

describe('patch', () => {
  it('updates a kept button in place, so it keeps focus and runs the newest handler', () => {
    const root = document.body.appendChild(h('div'));
    const seen: string[] = [];
    patch(root, list([{ key: 'a', votes: 1 }, { key: 'b', votes: 1 }], (v) => seen.push(v)));
    const button = root.querySelector<HTMLButtonElement>('[aria-label="Vote b"]')!;
    button.focus();
    patch(root, list([{ key: 'a', votes: 1 }, { key: 'b', votes: 4 }], (v) => seen.push(v)));
    const after = root.querySelector<HTMLButtonElement>('[aria-label="Vote b"]')!;
    expect(after).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('4');
    button.click();
    expect(seen).toEqual(['b:4']);
  });

  it('keeps focus on a button whose row moved when the order changed', () => {
    const root = document.body.appendChild(h('div'));
    patch(root, list([{ key: 'a', votes: 3 }, { key: 'b', votes: 1 }], vi.fn()));
    const button = root.querySelector<HTMLButtonElement>('[aria-label="Vote b"]')!;
    button.focus();
    patch(root, list([{ key: 'b', votes: 5 }, { key: 'a', votes: 3 }], vi.fn()));
    expect([...root.querySelectorAll('li')].map((li) => li.getAttribute('data-key'))).toEqual(['b', 'a']);
    expect(document.activeElement).toBe(button);
  });

  it('removes rows that went, adds new ones, and drops attributes that are no longer set', () => {
    const root = document.body.appendChild(h('div'));
    patch(root, h('p', { className: 'x', 'aria-busy': 'true' }, 'one'), h('span', {}, 'gone'));
    const p = root.querySelector('p')!;
    patch(root, h('p', { className: 'y' }, 'two'), h('strong', {}, 'new'));
    expect(root.querySelector('p')).toBe(p);
    expect(p.className).toBe('y');
    expect(p.hasAttribute('aria-busy')).toBe(false);
    expect(root.innerHTML).toBe('<p class="y">two</p><strong>new</strong>');
  });

  it('drops a handler the fresh node no longer declares, so a stale onclick cannot survive (L8)', () => {
    const root = document.body.appendChild(h('div'));
    const stale = vi.fn();
    patch(root, h('button', { type: 'button', onclick: stale }, 'Vote'));
    const button = root.querySelector('button')!;
    patch(root, h('button', { type: 'button', disabled: true }, 'Voted'));
    expect(root.querySelector('button')).toBe(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(stale).not.toHaveBeenCalled();
    // a handler declared again is heard again
    const fresh = vi.fn();
    patch(root, h('button', { type: 'button', onclick: fresh }, 'Vote'));
    button.click();
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});
