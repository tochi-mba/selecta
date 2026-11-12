import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeBackend, status } from '../test/backend';
import { Start, SUPPORTED_AUDIO } from './Start';

/** Polish ADR-0037 P0044/P0045: the first run has one primary action, says where to find the folder
 * and which files count, and gives each reason a folder can't be used its own words. */

const firstRun = (scan: Record<string, unknown> = { status: 'idle' }) =>
  status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, ready: 0, lyrics: 0 }, scan: scan as never });

afterEach(cleanup);

describe('P0044 first-run composition', () => {
  it('has one primary action, folder help and the supported kinds of file', () => {
    fakeBackend({});
    const { container } = render(<Start status={firstRun()} onChange={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Where’s your music?' })).toBeInTheDocument();
    expect(container.querySelectorAll('.primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('primary');
    const box = screen.getByRole('textbox', { name: 'Music folder' });
    const help = document.getElementById(box.getAttribute('aria-describedby')!.split(' ')[0])!;
    expect(help).toHaveTextContent(/copy its address, and paste it here/);
    expect(help).toHaveTextContent(SUPPORTED_AUDIO);
    for (const kind of ['MP3', 'FLAC', 'M4A', 'OGG', 'Opus', 'WAV', 'AIFF']) expect(SUPPORTED_AUDIO).toContain(kind);
  });
});

describe('P0045 each reason a folder can’t be used is its own', () => {
  const cases = [
    ['invalid', 'That isn’t a full folder address.', /starts with the drive letter/],
    ['missing', 'That folder doesn’t exist on this PC.', /plug that in first/],
    ['no_access', 'Selecta isn’t allowed to read that folder.', /folder your account can open/],
    ['empty', 'That folder is empty.', /Nothing is in there yet/],
    ['no_audio', 'There are no audio files in that folder.', /found no audio files, including in subfolders/],
  ] as const;
  for (const [kind, reason, advice] of cases) {
    it(`${kind} says why and what to try, and nothing is read`, async () => {
      const calls = fakeBackend({ 'GET /folders/check': { ok: false, kind, reason, path: 'x', audio_files: null } });
      render(<Start status={firstRun()} onChange={() => {}} />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Music folder' }), { target: { value: 'D:\\Music' } });
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      expect(await screen.findByText(reason)).toBeInTheDocument();
      expect(screen.getByText(advice)).toBeInTheDocument();
      expect(calls.some((call) => call.path === '/scan')).toBe(false);
    });
  }
  const advices = cases.map(([, , advice]) => advice.source);
  it('never gives two reasons the same advice', () => expect(new Set(advices).size).toBe(advices.length));

  it('a scan in progress, a failed scan and a stopped scan each say so', () => {
    fakeBackend({});
    const { rerender } = render(<Start status={firstRun({ status: 'running', folder: 'D:\\Music' })} onChange={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Finding music in your folder, D:\\Music/);
    expect(screen.getByRole('button', { name: 'Reading…' })).toBeDisabled();
    rerender(<Start status={firstRun({ status: 'failed', error: 'The drive went away.' })} onChange={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The drive went away.');
    rerender(<Start status={firstRun({ status: 'cancelled' })} onChange={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Stopped reading that folder/);
    rerender(<Start status={firstRun({ status: 'done', music: 0 })} onChange={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/No new music was found/);
  });
});

describe('P0048 the library and progress stay open while songs are prepared', () => {
  it('links to Library and progress before any mix can be made', async () => {
    const { Preparing } = await import('./Setup');
    fakeBackend({});
    render(<Preparing status={status({ analysis_running: true, counts: { total: 9, music: 9, set_aside: 0, analysed: 2, ready: 1, lyrics: 1 }, scan: { status: 'running', folder: 'D:\Music' } as never })} onAnalyse={() => {}} />);
    expect(screen.getByRole('link', { name: 'Open Library' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: 'See progress' })).toHaveAttribute('href', '/workshop');
    expect(screen.queryByRole('link', { name: 'Make my first mix' })).toBeNull();
    expect(screen.getByText('Analysing now')).toBeInTheDocument();
    expect(screen.getByText(/Still reading your folder/)).toBeInTheDocument();
  });
});
