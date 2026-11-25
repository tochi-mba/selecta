import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LUCY_WINDOWS } from '../test/cloudAccount';
import { LiveRegion } from '../ui/controls';
import type { LucyWindows } from '../cloud/lucyUsage';
import { LucyUsageMeter } from './LucyUsageMeter';

/** Nothing a person must never see in the Lucy usage UI (ADR-0484 rule 4). */
const NEVER_SHOWN = /turn|token|\$|Sonnet|Opus|Haiku|Claude/i;

const near: LucyWindows = { ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, left: 15, state: 'near', segments: 1 } };
const spent: LucyWindows = { ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, left: 0, state: 'spent', segments: 0 } };

describe('the Lucy usage meter (ADR-0484)', () => {
  it('shows two lines, each a bar of what is left with when it comes back', () => {
    const { container } = render(<LucyUsageMeter windows={LUCY_WINDOWS} />);
    const session = screen.getByRole('meter', { name: 'This session' });
    const week = screen.getByRole('meter', { name: 'This week' });
    expect(session).toHaveAttribute('aria-valuenow', '72');
    expect(session).toHaveAttribute('aria-valuetext', '72% left, back at 16:40');
    expect(week).toHaveAttribute('aria-valuenow', '90');
    expect(week).toHaveAttribute('aria-valuetext', '90% left, back Thursday 09:00');
    expect(container).toHaveTextContent('This session72% left · back at 16:40');
    expect(container).toHaveTextContent('This week90% left · back Thursday 09:00');
    expect(container.textContent).not.toMatch(NEVER_SHOWN);
    expect(container.textContent).not.toMatch(/used|of \d/i);
  });

  it('says the tone outright, because here a full bar is good news', () => {
    render(<LucyUsageMeter windows={{ ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, left: 100, segments: 5 } }} />);
    expect(screen.getByRole('meter', { name: 'This session' }).closest('.meter')).toHaveAttribute('data-status', 'neutral');
  });

  it('tells near and spent apart by a mark and by words, not by colour', () => {
    const one = render(<LucyUsageMeter windows={near} />);
    const nearLine = one.container.querySelector('.lucy-usage-line[data-state="near"]') as HTMLElement;
    expect(within(nearLine).getByText('Nearly used up')).toBeInTheDocument();
    expect(nearLine.querySelector('.ui-icon')).toHaveAttribute('data-icon', 'warning');
    expect(nearLine.querySelector('.meter')).toHaveAttribute('data-status', 'warning');
    one.unmount();
    const two = render(<LucyUsageMeter windows={spent} />);
    const spentLine = two.container.querySelector('.lucy-usage-line[data-state="spent"]') as HTMLElement;
    expect(within(spentLine).getByText('Used up')).toBeInTheDocument();
    expect(spentLine.querySelector('.ui-icon')).toHaveAttribute('data-icon', 'minus');
    expect(spentLine.querySelector('.meter')).toHaveAttribute('data-status', 'danger');
    // the week is fine, so it carries no mark and no state words
    const weekLine = two.container.querySelector('.lucy-usage-line[data-state="ok"]') as HTMLElement;
    expect(weekLine.querySelector('.ui-icon')).toBeNull();
  });

  it('reads a session nobody has started as full', () => {
    render(<LucyUsageMeter windows={{ ...LUCY_WINDOWS, session: { left: 100, state: 'ok', resets_at: null, back_words: null, segments: 5, open: false } }} />);
    expect(screen.getByRole('meter', { name: 'This session' })).toHaveAttribute('aria-valuetext', '100% left, not started');
  });

  it('has no session line for an account with no session window', () => {
    render(<LucyUsageMeter windows={{ ...LUCY_WINDOWS, session: null }} />);
    expect(screen.queryByRole('meter', { name: 'This session' })).toBeNull();
    expect(screen.getAllByRole('meter')).toHaveLength(1);
  });

  it('says when a lighter Lucy is answering, by level and never by name', () => {
    const { container } = render(<LucyUsageMeter windows={{ ...spent, lighter: true }} />);
    expect(screen.getByRole('note')).toHaveTextContent('A lighter Lucy is answering until this session ends at 16:40. After that Lucy is back to normal.');
    expect(container.textContent).not.toMatch(NEVER_SHOWN);
    expect(render(<LucyUsageMeter windows={LUCY_WINDOWS} />).container.querySelector('[role="note"]')).toBeNull();
  });

  it('shows an extra usage line only when the account has one', () => {
    const without = render(<LucyUsageMeter windows={LUCY_WINDOWS} />);
    expect(without.container).not.toHaveTextContent('Extra usage');
    without.unmount();
    const { container } = render(<LucyUsageMeter windows={{ ...LUCY_WINDOWS, extra: { left: 40 } }} />);
    expect(container.querySelector('.lucy-usage-extra')).toHaveTextContent('Extra usage40% left');
    expect(container.textContent).not.toMatch(NEVER_SHOWN);
  });

  it('announces a change of state once, politely, and stays quiet when only the figure moves', async () => {
    const view = render(<><LiveRegion /><LucyUsageMeter windows={LUCY_WINDOWS} /></>);
    const live = () => document.querySelector('[aria-live="polite"][role="status"]') as HTMLElement;
    view.rerender(<><LiveRegion /><LucyUsageMeter windows={{ ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, left: 50, segments: 3 } }} /></>);
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(live()).toHaveTextContent('');
    view.rerender(<><LiveRegion /><LucyUsageMeter windows={near} /></>);
    await waitFor(() => expect(live()).toHaveTextContent('This session: nearly used up, 15% left, back at 16:40.'));
    // the same figures drawn again are not news
    view.rerender(<><LiveRegion /><LucyUsageMeter windows={{ ...near }} /></>);
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(live()).toHaveTextContent('This session: nearly used up, 15% left, back at 16:40.');
  });
});
