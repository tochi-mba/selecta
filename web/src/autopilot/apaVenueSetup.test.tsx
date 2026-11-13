import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Policies, SetupState, stepBody, VenueSetup } from './VenueSetup';
import type { Api } from './VenueSetup';

// AV-0425-02: the guided venue setup asks the server for its steps, saves one step at a time,
// shows the server's field errors, and publishes only when every needed step is done.

const steps = ['venue', 'sources', 'content', 'limits', 'dayparts', 'closing', 'review'];

function state(done: string[]): SetupState {
  const next = steps.find((s) => !done.includes(s)) ?? null;
  return {
    venue_id: 'main',
    steps: steps.map((id) => ({ id, title: id === 'venue' ? 'Your venue' : id === 'review' ? 'Review' : id, help: '', required: id === 'venue' || id === 'sources', done: done.includes(id) })),
    saved: Object.fromEntries(done.map((id) => [id, id === 'review' ? { confirmed: true } : {}])),
    next_step: next,
    ready: done.includes('venue') && done.includes('sources'),
    missing: ['venue', 'sources'].filter((s) => !done.includes(s)),
  };
}

const noPolicy: Policies = { venue_id: 'main', effective: null, history: [] };

afterEach(cleanup);

describe('VenueSetup', () => {
  it('saves the first step and moves on', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const api = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push([path, init]);
      if (path.endsWith('/policies')) return noPolicy;
      if (init?.method === 'PUT') return state(['venue']);
      return state([]);
    }) as unknown as Api;
    render(<VenueSetup api={api} workspaceId="ws" />);
    const name = await screen.findByLabelText('Venue name');
    await userEvent.type(name, 'The Lantern');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    const put = calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/autopilot/venues/main/setup/venue');
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ name: 'The Lantern' });
    expect(screen.getByText('No policy published yet.')).toBeTruthy();
  });

  it('shows the server field errors', async () => {
    const api = (async (path: string, init?: RequestInit) => {
      if (path.endsWith('/policies')) return noPolicy;
      if (init?.method === 'PUT') throw Object.assign(new Error('setup_invalid'), { payload: { detail: { errors: { name: 'Give the venue a name.' } } } });
      return state([]);
    }) as Api;
    render(<VenueSetup api={api} workspaceId="ws" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Give the venue a name.');
  });

  it('publishes a new version once setup is ready', async () => {
    let published = false;
    const api = (async (path: string, init?: RequestInit) => {
      if (path.endsWith('/policies') && init?.method === 'POST') {
        published = true;
        const v = { version: 1, effective_from: '2026-11-12T18:00:00+00:00', name: 'The Lantern' };
        return { venue_id: 'main', effective: v, history: [v], published: v };
      }
      if (path.endsWith('/policies')) return noPolicy;
      return state(steps);
    }) as Api;
    render(<VenueSetup api={api} workspaceId="ws" />);
    const publish = await screen.findByRole('button', { name: 'Publish policy' });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(publish);
    await screen.findByText('Published version 1.');
    expect(published).toBe(true);
    expect(screen.getByText('In force: version 1 of 1.')).toBeTruthy();
  });

  it('turns form fields into the server body', () => {
    expect(stepBody('limits', { bpm_max: '128', energy_max: '', volume_cap: '0.7' })).toEqual({ bpm_max: 128, energy_max: null, volume_cap: 0.7 });
    expect(stepBody('content', { allow_explicit: false, banned_artists: 'A, B', banned_genres: '' })).toEqual({ allow_explicit: false, banned_artists: ['A', 'B'], banned_genres: [] });
    expect(stepBody('dayparts', { name: '', start: '', end: '', energy_max: '' })).toEqual({ dayparts: [] });
  });
});
