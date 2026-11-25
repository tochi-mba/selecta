import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { settleWords, whereWords } from './CloudLibrary';
import { CutoverNotice } from './migration/CutoverNotice';
import { UnfinishedUploads } from './UnfinishedUploads';

// Staging walkthrough fixes (docs/engineering/staging-walkthrough-notes.md items 2, 3, 4, 15).

afterEach(() => localStorage.clear());

describe('where songs live, and why counts change', () => {
  it('says where an account with Cloud storage keeps its songs, and which button does what', () => {
    expect(whereWords(false)).toBeNull();
    expect(whereWords(true)).toMatch(/Connect music adds them.*Add music uploads them/);
  });

  it('explains a drop in songs that can play here, and says nothing when nothing dropped', () => {
    expect(settleWords(2405, 2918)).toMatch(/^513 songs chosen here before need this browser’s permission again/);
    expect(settleWords(10, 10)).toBeNull();
  });
});

describe('the note for an account with Cloud storage', () => {
  it('tells a newly granted account Cloud storage is on, and keeps that note after an upload', () => {
    const { unmount } = render(<CutoverNotice accountId="u1" storedBytes={0} />);
    expect(screen.getByRole('heading', { name: 'Cloud storage is on for your account' })).toBeTruthy();
    unmount();
    render(<CutoverNotice accountId="u1" storedBytes={5_000_000} />);
    expect(screen.getByRole('heading', { name: 'Cloud storage is on for your account' })).toBeTruthy();
  });

  it('keeps the original note for an account that already held hosted music', () => {
    render(<CutoverNotice accountId="u2" storedBytes={5_000_000} />);
    expect(screen.getByRole('heading', { name: 'Nothing has changed for you' })).toBeTruthy();
  });
});

describe('unfinished uploads', () => {
  it('says an upload storage never started failed on our side, and offers Remove', () => {
    const session = { id: 's1', name: 'song.mp3', size: 10, part_size: 10, part_count: 1, status: 'planned' };
    render(<UnfinishedUploads api={(async () => ({})) as never} workspaceId="w" sessions={[session]} onChanged={() => undefined} />);
    expect(screen.getByText(/That was on our side, and nothing was lost/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.queryByText(/Choose the same file again/)).toBeNull();
  });
});
