import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LUCY_WINDOWS } from '../test/cloudAccount';
import type { LucyWindows } from '../cloud/lucyUsage';
import { LucyUsageLevels } from './LucyUsageLevels';

const NEVER_SHOWN = /turn|token|\$|Sonnet|Opus|Haiku|Claude/i;
const NAME = 'Lucy usage: 72% left this session, 90% left this week';
const withSession = (over: Partial<NonNullable<LucyWindows['session']>>): LucyWindows => ({ ...LUCY_WINDOWS, session: { ...LUCY_WINDOWS.session!, ...over } });
const near = withSession({ left: 15, state: 'near', segments: 1 });
const spent = withSession({ left: 0, state: 'spent', segments: 0 });
const lit = (ladder: Element | null) => ladder?.querySelectorAll('.lucy-ladder-seg[data-lit]').length;
const panel = () => document.querySelector('.lucy-levels-panel');

afterEach(() => { vi.unstubAllGlobals(); });

describe('the twin level meter (ADR-0484 rule 11)', () => {
  it('renders nothing until the server sends the new figures', () => {
    const { container } = render(<LucyUsageLevels windows={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a real button whose name carries both figures, with two ladders of five drawn for the eye only', () => {
    const { container } = render(<LucyUsageLevels windows={LUCY_WINDOWS} />);
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls');
    expect(button.querySelector('.lucy-levels-pair')).toHaveAttribute('aria-hidden', 'true');
    const ladders = [...container.querySelectorAll('.lucy-ladder')];
    expect(ladders.map((ladder) => ladder.getAttribute('data-kind'))).toEqual(['session', 'week']);
    for (const ladder of ladders) expect(ladder.querySelectorAll('.lucy-ladder-seg')).toHaveLength(5);
    expect(ladders.map(lit)).toEqual([4, 5]);
    expect(panel()).toBeNull();
  });

  it('draws only the week ladder for an account with no session window', () => {
    const { container } = render(<LucyUsageLevels windows={{ ...LUCY_WINDOWS, session: null }} />);
    expect([...container.querySelectorAll('.lucy-ladder')].map((ladder) => ladder.getAttribute('data-kind'))).toEqual(['week']);
    expect(screen.getByRole('button')).toHaveAccessibleName('Lucy usage: 90% left this week');
  });

  it('opens on a tap or click with both lines, and a second one closes it', async () => {
    render(<LucyUsageLevels windows={LUCY_WINDOWS} onSettings={() => {}} />);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toHaveAttribute('id', button.getAttribute('aria-controls'));
    expect(panel()).toHaveTextContent('This session: 72% left, back at 16:40');
    expect(panel()).toHaveTextContent('This week: 90% left, back Thursday 09:00');
    expect(panel()!.textContent).not.toMatch(NEVER_SHOWN);
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toBeNull();
  });

  it('opens when the keyboard reaches it, and Escape closes it and leaves the focus on the button', async () => {
    render(<><LucyUsageLevels windows={LUCY_WINDOWS} onSettings={() => {}} /><button type="button">After</button></>);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(panel()).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape from the link inside hands the focus back to the button without opening it again', async () => {
    render(<LucyUsageLevels windows={LUCY_WINDOWS} onSettings={() => {}} />);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'See the full meter in Lucy’s settings' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(button).toHaveFocus();
    expect(panel()).toBeNull();
  });

  it('closes on a press outside, and when the keyboard moves on', async () => {
    render(<><LucyUsageLevels windows={LUCY_WINDOWS} /><button type="button">After</button><p>Elsewhere</p></>);
    const button = screen.getByRole('button', { name: NAME });
    await userEvent.click(button);
    expect(panel()).not.toBeNull();
    await userEvent.click(screen.getByText('Elsewhere'));
    expect(panel()).toBeNull();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(panel()).toBeNull();
  });

  it('opens for a resting pointer only where a pointer can really hover', async () => {
    render(<LucyUsageLevels windows={LUCY_WINDOWS} />);
    const button = screen.getByRole('button', { name: NAME });
    // a touch screen: resting is not a thing, so only the tap opens it
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    await userEvent.hover(button);
    expect(panel()).toBeNull();
    await userEvent.unhover(button);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(hover: hover) and (pointer: fine)', media: query, addEventListener() {}, removeEventListener() {} }));
    await userEvent.hover(button);
    expect(panel()).not.toBeNull();
    await userEvent.unhover(button);
    expect(panel()).toBeNull();
  });

  it('has one link, to the full meter in Lucy’s settings, and never to a plan or a purchase', async () => {
    const onSettings = vi.fn();
    render(<LucyUsageLevels windows={LUCY_WINDOWS} onSettings={onSettings} />);
    await userEvent.click(screen.getByRole('button', { name: NAME }));
    expect(panel()!.querySelectorAll('a')).toHaveLength(0);
    expect(panel()!.querySelectorAll('button')).toHaveLength(1);
    expect(panel()!.textContent).not.toMatch(/plan|upgrade|buy|billing/i);
    await userEvent.click(screen.getByRole('button', { name: 'See the full meter in Lucy’s settings' }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it('tells near and spent apart by shape and by words: a marker above, or an empty ladder', async () => {
    const one = render(<LucyUsageLevels windows={near} />);
    const nearLadder = one.container.querySelector('.lucy-ladder[data-kind="session"]')!;
    expect(nearLadder.querySelector('.lucy-ladder-mark')).not.toBeNull();
    expect(lit(nearLadder)).toBe(1);
    // the week beside it is quiet
    expect(one.container.querySelector('.lucy-ladder[data-kind="week"] .lucy-ladder-mark')).toBeNull();
    await userEvent.click(screen.getByRole('button'));
    expect(panel()).toHaveTextContent('This session: 15% left, back at 16:40 · Nearly used up');
    one.unmount();

    const two = render(<LucyUsageLevels windows={spent} />);
    const spentLadder = two.container.querySelector('.lucy-ladder[data-kind="session"]')!;
    expect(spentLadder).toHaveAttribute('data-state', 'spent');
    expect(spentLadder.querySelector('.lucy-ladder-mark')).toBeNull();
    expect(lit(spentLadder)).toBe(0);
    await userEvent.click(screen.getByRole('button'));
    expect(panel()).toHaveTextContent('This session: 0% left, back at 16:40 · Used up');
    // more than a class: the two differ in what is in the page
    expect(nearLadder.innerHTML).not.toBe(spentLadder.innerHTML);
  });

  it('a spent ladder is empty even if the figures disagree, and a full one lights all five', () => {
    const { container } = render(<LucyUsageLevels windows={{ ...withSession({ left: 0, state: 'spent', segments: 3 }), week: { ...LUCY_WINDOWS.week, segments: 5 } }} />);
    expect([...container.querySelectorAll('.lucy-ladder')].map(lit)).toEqual([0, 5]);
  });

  it('says a lighter Lucy is answering, in the label', async () => {
    render(<LucyUsageLevels windows={{ ...spent, lighter: true }} />);
    await userEvent.click(screen.getByRole('button'));
    expect(panel()).toHaveTextContent('A lighter Lucy is answering until this session ends.');
    expect(panel()!.textContent).not.toMatch(NEVER_SHOWN);
  });
});
