import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setFlags } from '../../flags';
import { IDLE_IMPORT, type ImportSnapshot } from '../importSession';
import { FRESH } from './state';
import { VerifyStep } from './steps';

// Onboarding's import step with cloud.resilient_import: real counts, plain words for each wait,
// Stop asks first, and a stopped import says what is kept with no raw error.

const live = (over: Partial<ImportSnapshot> = {}): ImportSnapshot => ({ ...IDLE_IMPORT, phase: 'running', total: 1280, checked: 412, ...over });

function verify(snapshot: ImportSnapshot, onChange = vi.fn()) {
  render(
    <VerifyStep
      state={{ ...FRESH, step: 'verify' }}
      onChange={onChange}
      deps={{} as never}
      live={snapshot}
      earlyContinue
      onStop={vi.fn()}
      onContinueEarly={vi.fn()}
    />,
  );
  return onChange;
}

describe('onboarding import step (cloud.resilient_import)', () => {
  it('shows real counts and promises to carry on if the tab closes', () => {
    verify(live({ resumed: 412 }));
    expect(screen.getByText('Carrying on your import: 412 of 1,280 checked.')).toBeInTheDocument();
    expect(screen.getByText(/If this tab closes, the import carries on from where it got to next time/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue while it finishes' })).toBeInTheDocument();
  });

  it('offline: says it carries on when the connection is back, as a status', () => {
    verify(live({ waiting: { why: 'offline', retryAt: null } }));
    expect(screen.getByRole('status')).toHaveTextContent('Offline. 412 of 1,280 checked. Carries on when you’re back online.');
  });

  it('another tab importing: follows its progress', () => {
    verify(live({ elsewhere: true }));
    expect(screen.getByText('Another tab is importing. Progress shows here too: 412 of 1,280 checked.')).toBeInTheDocument();
  });

  it('Stop here asks first', () => {
    verify(live());
    fireEvent.click(screen.getByRole('button', { name: 'Stop here' }));
    expect(screen.getByText('Stop this import?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep importing' })).toBeInTheDocument();
  });

  it('a stopped import says what is kept, never a raw error, and Try again goes back to connect', () => {
    const onChange = verify(live({ phase: 'failed', error: 'The import stopped part way. Everything already checked is kept, and it carries on from there.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Everything already checked is kept');
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ step: 'connect' }));
  });

  it('with the flag off the step reads as it always did', () => {
    setFlags({ 'cloud.resilient_import': false });
    verify(live({ waiting: { why: 'offline', retryAt: null } }));
    expect(screen.queryByText(/Carries on when you’re back online/)).toBeNull();
  });
});
