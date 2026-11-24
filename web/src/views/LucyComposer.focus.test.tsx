import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './LucyComposer';

// Send is disabled while the box is empty. Pressing Send itself (not Enter in the box) emptied
// the box, disabled the button under the keyboard's focus, and the focus fell to the page's top.

function Harness({ onSend }: { onSend: () => void }) {
  const [value, setValue] = useState('Something calm for a Sunday');
  const box = useRef<HTMLTextAreaElement>(null);
  return <Composer value={value} onChange={setValue} onSend={() => { onSend(); setValue(''); }} onStop={async () => undefined} running={false} sending={false} blocked="" voice={false} boxRef={box} />;
}

describe('the message box keeps the keyboard’s place', () => {
  it('puts the focus back in the box when Send itself is pressed', async () => {
    const sent = vi.fn();
    render(<Harness onSend={sent} />);
    const send = screen.getByRole('button', { name: 'Send' });
    send.focus();
    await userEvent.keyboard('{Enter}');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(send).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Message to Lucy' })).toHaveFocus();
  });

  it('Enter sends and Shift+Enter starts a new line', async () => {
    const sent = vi.fn();
    render(<Harness onSend={sent} />);
    const box = screen.getByRole('textbox', { name: 'Message to Lucy' });
    await userEvent.click(box);
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(sent).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toContain('\n');
    await userEvent.keyboard('{Enter}');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(box).toHaveFocus();
  });
});
