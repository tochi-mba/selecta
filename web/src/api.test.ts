import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { post } from './api';

function pressing(send: () => void) {
  const button = document.createElement('button');
  document.body.append(button);
  button.addEventListener('click', send);
  return button;
}

describe('every button says it’s working', () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('from the moment it’s pressed, until the answer comes', async () => {
    let finish: (value: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const button = pressing(() => { void post('/thing'); });
    button.click();
    expect(button).toHaveAttribute('aria-busy', 'true');
    finish(new Response('{}', { status: 200 }));
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('stops if it fails, too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const button = pressing(() => { void post('/thing').catch(() => {}); });
    button.click();
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('keeps going until everything it set off has finished', async () => {
    const finish: ((value: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish.push(resolve); })));
    const button = pressing(() => { void post('/one'); void post('/two'); });
    button.click();
    finish[0](new Response('{}', { status: 200 }));
    await new Promise((done) => setTimeout(done, 5));
    expect(button).toHaveAttribute('aria-busy', 'true');
    finish[1](new Response('{}', { status: 200 }));
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('isn’t set off by work happening in the background', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const button = pressing(() => {});
    button.click();
    await new Promise((done) => setTimeout(done, 200));
    void post('/background');
    expect(button).not.toHaveAttribute('aria-busy');
  });
});
