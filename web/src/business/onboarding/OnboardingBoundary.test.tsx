// BZ-0441-04: business onboarding says plainly that the business brings its own music and
// licences, guests never receive audio and personal and business libraries stay apart.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../cloud/api';
import { businessClient } from '../client';
import { BusinessContext, type BusinessCtx } from '../context';
import { BOUNDARY_COPY } from '../copy/pricing';
import { NOW, org, venue } from '../fixtures';
import { OnboardingPage } from './OnboardingPage';

describe('onboarding boundary', () => {
  it('shows the product boundary on the first step', () => {
    const ctx = {
      org: org(), venues: [venue('camden', 'Camden')], devices: [], activity: [],
      client: businessClient(vi.fn() as unknown as Api, 'ws-crown'), now: NOW, offline: false, updatedAt: NOW,
      health: { stream: 'live' }, loading: false, readOnly: false, refresh: async () => {}, go: vi.fn(),
    } as unknown as BusinessCtx;
    render(<BusinessContext.Provider value={ctx}><OnboardingPage /></BusinessContext.Provider>);
    for (const line of [BOUNDARY_COPY.ownMusic, BOUNDARY_COPY.ownLicence, BOUNDARY_COPY.noGuestAudio, BOUNDARY_COPY.separate]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    expect(BOUNDARY_COPY.ownMusic).toMatch(/SelectaDJ/);
  });
});
