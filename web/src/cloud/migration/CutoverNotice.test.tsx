import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUTOVER_NOTICE_PREFIX, CutoverNotice } from './CutoverNotice';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('cutover notice (BF-0465-04)', () => {
  it('says calmly that nothing changed, what the default means and the voluntary path', () => {
    render(<CutoverNotice accountId="acct-1" />);
    const notice = screen.getByRole('region', { name: 'Nothing has changed for you' });
    expect(notice).toHaveTextContent('work exactly as they did');
    expect(notice).toHaveTextContent('New accounts now start with music that stays on their own device');
    expect(notice).toHaveTextContent('entirely up to you');
    expect(notice.textContent).not.toMatch(/deprecat|legacy|days left|deadline|countdown|soon|must|will be removed|retire/i);
  });

  it('stays dismissed for that account once dismissed', async () => {
    const { unmount } = render(<CutoverNotice accountId="acct-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'Nothing has changed for you' })).toBeNull();
    expect(localStorage.getItem(`${CUTOVER_NOTICE_PREFIX}acct-1`)).toBe('dismissed');
    unmount();
    render(<CutoverNotice accountId="acct-1" />);
    expect(screen.queryByRole('region', { name: 'Nothing has changed for you' })).toBeNull();
  });

  it('is per account, and the close button dismisses too', async () => {
    localStorage.setItem(`${CUTOVER_NOTICE_PREFIX}acct-1`, 'dismissed');
    render(<CutoverNotice accountId="acct-2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss this note' }));
    expect(localStorage.getItem(`${CUTOVER_NOTICE_PREFIX}acct-2`)).toBe('dismissed');
  });

  it('still shows and dismisses when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<CutoverNotice accountId="acct-3" />);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'Nothing has changed for you' })).toBeNull();
  });
});
