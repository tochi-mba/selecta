import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { prefs, reloadPrefs } from '../state/prefs';
import { feelOff } from '../test/feel';
import { InterfaceChoices } from './InterfaceChoices';

/** Plan 3.12: with the feel on, theme and motion are cards (a small page in each theme's colours, a
 * dot that moves the way each level moves); the radios and their names are the chips' own. With the
 * feel off, the chips as before. */

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
});

describe('Interface choices as cards', () => {
  it('draws a decorative preview on each theme card and a demonstration on each motion card', async () => {
    const { container } = render(<InterfaceChoices classicNav={false} />);
    expect(container.querySelectorAll('.ic-preview')).toHaveLength(3);
    for (const preview of container.querySelectorAll('.ic-preview')) expect(preview).toHaveAttribute('aria-hidden', 'true');
    // System shows both palettes, the others one each
    expect(container.querySelectorAll('.ic-pane')).toHaveLength(4);
    expect([...container.querySelectorAll('.ic-motion-demo')].map((demo) => demo.getAttribute('data-level'))).toEqual(['still', 'subtle', 'expressive']);
    const still = screen.getByRole('radio', { name: 'Still' });
    expect(still).toHaveAccessibleDescription('Nothing moves by itself.');
    await userEvent.click(still);
    expect(prefs().motion).toBe('still');
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(prefs().theme).toBe('dark');
  });

  it('keeps the chips with the feel off', () => {
    feelOff();
    const { container } = render(<InterfaceChoices classicNav={false} />);
    expect(container.querySelector('.ic-cards')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Subtle' })).toBeInTheDocument();
  });
});
