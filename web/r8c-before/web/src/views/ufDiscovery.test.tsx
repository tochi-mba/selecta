import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, status as appStatus } from '../test/backend';
import { HarmonicDiscoveries, Links } from './Links';

/** UF-0384-06: an empty discovery page says why and offers the action that would change it. */

const props = (tab: 'words' | 'harmonic') => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab }) as unknown as Parameters<typeof Links>[0];
afterEach(() => vi.unstubAllGlobals());

describe('UF-0384-06 no results are meaningful', () => {
  it('no chord matches yet points at analysis progress', async () => {
    fakeBackend({ 'GET /discoveries': [] });
    render(<HarmonicDiscoveries />);
    expect(await screen.findByText(/No chord matches to hear yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See analysis progress' })).toHaveAttribute('href', '/workshop');
  });

  it('no word links yet points at analysis progress', async () => {
    fakeBackend({ 'GET /links': { links: [], prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [] } });
    render(<Links {...props('words')} />);
    expect(await screen.findByText(/No links yet\. Analysing more songs will find more\./, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See analysis progress' })).toHaveAttribute('href', '/workshop');
  });

  it('a search with no match offers to clear it instead', async () => {
    window.history.pushState({}, '', '/discover?q=zebra');
    fakeBackend({ 'GET /links': { links: [], prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [] } });
    render(<Links {...props('words')} />);
    expect(await screen.findByText(/No links on “zebra” yet\./, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See analysis progress' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByLabelText('Search shared words')).toHaveValue('');
    window.history.pushState({}, '', '/');
  });
});
