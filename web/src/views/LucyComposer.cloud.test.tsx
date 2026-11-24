import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Request } from '../api';
import { setLucyTransport } from '../lucy/client';
import { Composer } from './LucyComposer';

// ADR-0476 item 16: Cloud answers one message at a time on every device, so the box must not
// promise that sending replaces the running answer, as local Lucy does.

function Box() {
  const box = useRef<HTMLTextAreaElement>(null);
  return <Composer value="one more" onChange={() => undefined} onSend={() => undefined} onStop={async () => undefined} running sending={false} blocked="" voice={false} boxRef={box} />;
}

afterEach(() => setLucyTransport(null));

describe('the box while Lucy answers', () => {
  it('says to wait or stop in Cloud', () => {
    setLucyTransport({ request: (async () => ({})) as Request, base: '/lucy-cloud', pollMs: 500 });
    render(<Box />);
    expect(screen.getByText('Lucy is answering. Send this when she’s done, or press Stop.')).toBeInTheDocument();
  });

  it('keeps local Lucy’s words where a new message replaces the answer', () => {
    render(<Box />);
    expect(screen.getByText('Lucy is working. Sending now replaces what it’s doing.')).toBeInTheDocument();
  });
});
