import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const quality = () => within(screen.getByRole('radiogroup', { name: 'Quality of A' }));
    fireEvent.click(quality().getByRole('radio', { name: '5 · Excellent' }));
    expect(quality().getByRole('radio', { name: '5 · Excellent' })).toBeChecked();
    const issues = () => within(screen.getByRole('group', { name: 'Issues with A, if any' }));
    expect(issues().getByRole('checkbox', { name: 'beat' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    await waitFor(() => expect(quality().getByRole('radio', { name: '5 · Excellent' })).not.toBeChecked());
    expect(issues().getByRole('checkbox', { name: 'beat' })).toBeDisabled();
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

describe('answering a comparison', () => {
  const open = async () => {
    render(<Listening />);
    fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'test' } });
    fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'one' } });
    fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    await screen.findByText(/Comparison 1 of/);
  };

  it('issues are ordinary checkboxes, and only count once it’s been rated', async () => {
    fakeBackend({ 'GET /listening': [{ id: 'opaque' }] });
    await open();
    const issues = within(screen.getByRole('group', { name: 'Issues with A, if any' }));
    expect(issues.getByRole('checkbox', { name: 'key' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Quality of A' })).getByRole('radio', { name: '3' }));
    fireEvent.click(issues.getByRole('checkbox', { name: 'key' }));
    expect(issues.getByRole('checkbox', { name: 'key' })).toBeChecked();
  });

  it('what’s saved is the same grade and tags as ever', async () => {
    const calls = fakeBackend({ 'GET /listening': [{ id: 'opaque' }], 'POST /listening/opaque/response': {} });
    await open();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Quality of A' })).getByRole('radio', { name: '4' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Issues with A, if any' })).getByRole('checkbox', { name: 'beat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      listener: 'one',
      setup: 'headphones',
      choice: 'cannot_judge',
      quality: { a: { grade: 4, tags: ['beat'] } },
    }));
  });

  it('won’t let you choose between two you haven’t both heard', async () => {
    fakeBackend({ 'GET /listening': [{ id: 'opaque' }] });
    await open();
    expect(screen.getByRole('button', { name: 'Prefer A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cannot judge' })).toBeEnabled();
    expect(screen.getByText('Listen to both to choose between them.')).toBeInTheDocument();
  });
});
