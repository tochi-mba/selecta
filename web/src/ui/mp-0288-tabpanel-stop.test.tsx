import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './primitives';

// MP-0288-06 / EX-0120-02: in the 320px inspector sheet, Tab from the transition's tabs used to land on
// the whole Change panel, a box taller than a phone's screen, so focus sat off screen. Following the ARIA
// tabs pattern, the panel is a stop of its own only when nothing inside it can take focus.
type Tab = 'listen' | 'change';

function Probe({ late = false }: { late?: boolean }) {
  const [tab, setTab] = useState<Tab>('change');
  const [extra, setExtra] = useState(false);
  return (
    <>
      <button onClick={() => setExtra(true)}>Load more</button>
      <Tabs label="This transition" tabs={[{ id: 'listen', label: 'Listen' }, { id: 'change', label: 'Change' }]} current={tab} onChange={setTab}>
        {tab === 'change' && !late ? (
          <fieldset>
            <legend>How should this land?</legend>
            <button>Smooth blend</button>
            <button>Cut</button>
          </fieldset>
        ) : (
          <>
            <p>What you’d hear, in words.</p>
            {extra && <button>Hear it</button>}
            <button disabled>Not yet</button>
          </>
        )}
      </Tabs>
    </>
  );
}

describe('MP-0288-06 an inspector panel full of controls is not a tab stop of its own', () => {
  it('Tab from the selected tab goes to the first move, not to the tall panel', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1');
    screen.getByRole('tab', { name: 'Change' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Smooth blend' })).toHaveFocus();
  });

  it('a panel with only words (or only disabled buttons) stays reachable as one stop', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByRole('tab', { name: 'Listen' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    screen.getByRole('tab', { name: 'Listen' }).focus();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('follows controls that appear later in the same panel', async () => {
    render(<Probe late />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    await act(async () => { screen.getByRole('button', { name: 'Load more' }).click(); });
    expect(await screen.findByRole('button', { name: 'Hear it' })).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1');
  });
});
