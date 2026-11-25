import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { CatalogLookups, LOOKUP_DISCLOSURE } from './CatalogLookups';

/** FL-0478-04: the account's choice about web lookups. It says plainly what leaves, reads and
 * writes `/catalog/settings`, and only ever shows what the server answered. */

type Init = RequestInit | undefined;

function server(answers: { get?: () => Promise<unknown>; put?: (body: unknown) => Promise<unknown> }) {
  return vi.fn((path: string, init?: Init) => {
    expect(path).toBe('/catalog/settings');
    if (init?.method === 'PUT') return answers.put ? answers.put(JSON.parse(String(init.body))) : Promise.reject(new Error('no'));
    return answers.get ? answers.get() : Promise.reject(new Error('no'));
  }) as unknown as (<T>(path: string, init?: RequestInit) => Promise<T>) & ReturnType<typeof vi.fn>;
}

describe('FL-0478-04 CatalogLookups', () => {
  it('is not there at all with library.art_lookup off, and asks the server nothing', () => {
    setFlags({ 'library.art_lookup': false });
    const request = server({ get: async () => ({ lookups: true }) });
    const { container } = render(<CatalogLookups request={request} />);
    expect(container).toBeEmptyDOMElement();
    expect(request).not.toHaveBeenCalled();
  });

  it('reads the saved choice and says what a lookup sends', async () => {
    const request = server({ get: async () => ({ lookups: true }) });
    render(<CatalogLookups request={request} />);
    expect(screen.getByText(LOOKUP_DISCLOSURE)).toBeInTheDocument();
    expect(LOOKUP_DISCLOSURE).toBe('Only the artist, title, album and length of a song are sent.');
    const toggle = await screen.findByRole('switch', { name: 'Look up covers and song details on the web' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(LOOKUP_DISCLOSURE);
    expect(request).toHaveBeenCalledWith('/catalog/settings');
  });

  it('writes the change and shows what the server answered', async () => {
    const put = vi.fn(async (body: unknown) => body);
    const request = server({ get: async () => ({ lookups: false }), put });
    render(<CatalogLookups request={request} />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(put).toHaveBeenCalledWith({ lookups: true });
    expect(await screen.findByRole('switch', { checked: true })).toBeInTheDocument();
  });

  it('never shows a choice the server did not keep', async () => {
    const request = server({ get: async () => ({ lookups: false }), put: async () => ({ lookups: false }) });
    render(<CatalogLookups request={request} />);
    fireEvent.click(await screen.findByRole('switch'));
    await screen.findByRole('switch', { checked: false });
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('says so when the choice cannot be read', async () => {
    const request = server({ get: () => Promise.reject(new Error('offline')) });
    render(<CatalogLookups request={request} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your choice could not be read just now.');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('says so when the change is not saved, and keeps the last saved choice', async () => {
    const request = server({ get: async () => ({ lookups: true }), put: () => Promise.reject(new Error('offline')) });
    render(<CatalogLookups request={request} />);
    fireEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your choice was not saved. Nothing has changed.');
    expect(screen.getByRole('switch')).toBeChecked();
  });
});
