import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Permission, ProposalSnapshot, PSong } from '../lucy/types';
import { feelOff } from '../test/feel';
import { PermissionCard } from './LucyCards';
import { Composer } from './LucyComposer';
import { SongsAndSeams } from './LucySongs';

/** Plan 3.9 with the feel on (the default in tests) and off: an answered request becomes a receipt
 * that keeps everything it named, and Send becomes Stop only while Lucy works and nothing is
 * written. With the feel off both are exactly as before. */

const permission: Permission = { id: 'perm', tier: 'play', operation: 'play_mix', arguments: { mix: 'Sunday' }, text: 'Play Sunday now?', status: 'pending', run: 'r1' } as Permission;

describe('an answered request', () => {
  it('settles into a one-line receipt, with a tick drawn only for a yes given here', () => {
    const onDecide = vi.fn(async () => {});
    const { rerender, container } = render(<PermissionCard permission={permission} onDecide={onDecide} />);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    rerender(<PermissionCard permission={{ ...permission, status: 'allowed' }} onDecide={onDecide} />);
    const receipt = screen.getByRole('article', { name: /You allowed this/ });
    expect(receipt).toHaveClass('is-receipt');
    expect(within(receipt).getByText('Play Sunday now?')).toBeInTheDocument();
    expect(container.querySelector('.lucy-receipt-tick .feel-tick')).not.toBeNull();
    // what it would have acted on is one press away, not lost
    expect(within(receipt).getByText('What it was for')).toBeInTheDocument();
    expect(within(receipt).getByText('Sunday')).toBeInTheDocument();
  });

  it('draws no tick for an answer it did not see given', () => {
    const { container } = render(<PermissionCard permission={{ ...permission, status: 'allowed' }} onDecide={vi.fn(async () => {})} />);
    expect(container.querySelector('.lucy-receipt-tick')).not.toBeNull();
    expect(container.querySelector('.feel-tick')).toBeNull();
  });

  it('keeps the full card with the feel off', () => {
    feelOff();
    render(<PermissionCard permission={{ ...permission, status: 'allowed' }} onDecide={vi.fn(async () => {})} />);
    expect(screen.getByRole('article', { name: 'Lucy wants to change what’s playing' })).not.toHaveClass('is-receipt');
    expect(screen.getByText('You allowed this')).toBeInTheDocument();
  });
});

function Harness({ running }: { running: boolean }) {
  const [value, setValue] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  return <Composer value={value} onChange={setValue} onSend={() => undefined} onStop={async () => undefined} running={running} sending={false} blocked="" voice={false} boxRef={box} />;
}

describe('Send and Stop', () => {
  it('Stop takes Send’s place while Lucy works and nothing is written, and Send comes back for words', async () => {
    const { rerender } = render(<Harness running={false} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    rerender(<Harness running />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByRole('button', { name: /Stop/ })).toHaveClass('primary');
    await act(async () => {
      const box = screen.getByRole('textbox', { name: 'Message to Lucy' }) as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, 'one more');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Stop/ })).not.toHaveClass('primary');
  });

  it('keeps both, as before, with the feel off', () => {
    feelOff();
    render(<Harness running />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();
  });
});

const song = (n: number): PSong => ({ occurrence: `occ_${n}`, song_id: n, artist: `Artist ${n}`, title: `Song ${n}`, duration: 200, bpm: 120, key: '8A', energy: 0.5, locked: false } as PSong);
const snap = (songs: PSong[]) => ({ title: 'Sunday', ready_only: false, songs, seams: [] } as unknown as ProposalSnapshot);
const songProps = { ledger: undefined, editable: true, selection: null, onAsk: vi.fn(), onEdit: vi.fn(async () => true) };

describe('a song the new revision took out', () => {
  it('stays a moment, struck through and hidden from assistive technology, where it stood', () => {
    const { rerender, container } = render(<SongsAndSeams {...songProps} snapshot={snap([song(1), song(2), song(3)])} />);
    rerender(<SongsAndSeams {...songProps} snapshot={snap([song(1), song(3)])} />);
    const slots = [...container.querySelectorAll('.lucy-song-slot')];
    expect(slots).toHaveLength(3);
    expect(slots[1]).toHaveClass('is-gone', 'feel-collapse-out');
    expect(slots[1]).toHaveAttribute('aria-hidden', 'true');
    expect(slots[1].querySelector('[data-occ]')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.animationEnd(slots[1]);
    expect(container.querySelectorAll('.lucy-song-slot')).toHaveLength(2);
  });

  it('simply goes with the feel off', () => {
    feelOff();
    const { rerender, container } = render(<SongsAndSeams {...songProps} snapshot={snap([song(1), song(2)])} />);
    rerender(<SongsAndSeams {...songProps} snapshot={snap([song(1)])} />);
    expect(container.querySelectorAll('.lucy-song-slot')).toHaveLength(1);
  });
});
