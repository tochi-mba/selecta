import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CUTOVER_NOTICE_PREFIX, CutoverNotice } from './migration/CutoverNotice';
import { NoticeStack } from './NoticeStack';

afterEach(() => { localStorage.clear(); });

// the shell's banner area: each notice must stay a direct child of it, so it keeps its own look
const inBanner = (stack: ReactElement) => render(<div className="shell-banners" data-testid="banners">{stack}</div>);
const expanded = () => document.querySelectorAll('[data-notice-expanded]');
const Nothing = () => null;

describe('notice stack (cloud.page_layout)', () => {
  it('opens the most pressing notice and folds the rest behind one button that counts them', async () => {
    inBanner(<NoticeStack
      blocking={<p>Over your storage limit</p>}
      playback={<p>Asked to play here</p>}
      progress={<div className="cloud-import-chip">Adding your music</div>}
      info={<><p>Your cloud library and mixes work as before.</p><Nothing /></>}
    />);
    expect(expanded()).toHaveLength(1);
    expect(screen.getByText('Over your storage limit')).toHaveAttribute('data-notice-expanded');
    expect(screen.getByText('Adding your music')).toHaveAttribute('data-notice-chip');
    expect(screen.getByText('Asked to play here')).toHaveAttribute('data-notice-folded');
    // a notice that draws nothing is not counted
    const more = screen.getByRole('button', { name: '2 more notes' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('2 more notes');
    await userEvent.click(more);
    expect(screen.getByRole('button', { name: 'Hide 2 notes' })).toHaveAttribute('aria-expanded', 'true');
    // every notice stays a direct child of the banner area
    for (const notice of screen.getByTestId('banners').querySelectorAll('p')) expect(notice.parentElement).toBe(screen.getByTestId('banners'));
  });

  it('with no blocking notice the first playback notice is the open one, and one notice has no button', () => {
    inBanner(<NoticeStack playback={<p>Playing on Laptop</p>} />);
    expect(screen.getByText('Playing on Laptop')).toHaveAttribute('data-notice-expanded');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('counts again when a notice comes or goes without the stack drawing again', async () => {
    let show: (on: boolean) => void = () => {};
    function Late() {
      const [on, setOn] = useState(false);
      show = setOn;
      return on ? <p>Live updates are paused</p> : null;
    }
    inBanner(<NoticeStack blocking={<p>Account problem</p>} info={<Late />} />);
    expect(screen.queryByRole('button')).toBeNull();
    await act(async () => { show(true); });
    expect(await screen.findByRole('button', { name: '1 more note' })).toBeInTheDocument();
    expect(expanded()).toHaveLength(1);
    await act(async () => { show(false); });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the cutover note is one line, dismissed for good in the same place as the card', async () => {
    render(<CutoverNotice accountId="acct-1" line />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Your cloud library and mixes work as before.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem(`${CUTOVER_NOTICE_PREFIX}acct-1`)).toBe('dismissed');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
