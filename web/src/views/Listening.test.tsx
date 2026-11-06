import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import { Listening } from './Listening';

describe('blind listening responses', () => {
  it('clears quality ratings when reopening a study', async () => {
    fakeBackend({ 'GET /listening': [{ id: 'opaque' }] });
    render(<Listening />);
    fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'test' } });
    fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'one' } });
    fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    await screen.findByText('Comparison 1 of 1');
    fireEvent.change(screen.getByLabelText('Quality of A'), { target: { value: '5' } });
    expect(screen.getByLabelText('Quality of A')).toHaveValue('5');
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    await waitFor(() => expect(screen.getByLabelText('Quality of A')).toHaveValue(''));
    expect(screen.getByLabelText('Issues with A')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prefer A' })).toBeDisabled();
  });

  it('keeps a failed save on its current trial', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const calls = fakeBackend({ 'GET /listening': [{ id: 'opaque' }] });
    render(<Listening />);
    fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'test' } });
    fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'one' } });
    fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    expect(await screen.findByText('Comparison 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prefer A' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your response was not saved');
    expect(screen.getByText('Comparison 1 of 1')).toBeInTheDocument();
    expect(screen.queryByText('All responses saved. Thank you for listening.')).toBeNull();
    expect(calls.some((call) => call.path === '/listening/opaque/response' && (call.body as { choice?: string }).choice === 'cannot_judge')).toBe(true);
  });
});
