import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Workshop } from './Workshop';
import { WINDOWS_EXAMPLE_FOLDER } from './WorkshopPanels';

/** Workspace > Sources showed "C:\\Users\\you\\Music" with doubled backslashes, because JSX text
 * and attribute strings don't read escapes. Both places now show one backslash per separator. */

function showSources() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Workshop
      tab="sources"
      status={status()}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={() => {}}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

const SINGLE = 'C:' + '\\' + 'Users' + '\\' + 'you' + '\\' + 'Music';

describe('Sources example folder paths', () => {
  it('the Windows example is written with single backslashes', () => {
    expect(WINDOWS_EXAMPLE_FOLDER).toBe(SINGLE);
    expect(WINDOWS_EXAMPLE_FOLDER).not.toContain('\\\\');
  });

  it('the example line and the Music folder placeholder show single backslashes', async () => {
    fakeBackend({ 'GET /folders': { folders: [], watch_every: 60 } });
    showSources();
    const field = await screen.findByRole('textbox', { name: 'Music folder' });
    expect(field).toHaveAttribute('placeholder', SINGLE);
    const example = screen.getByText(SINGLE, { selector: 'code' });
    expect(example.textContent).toBe(SINGLE);
    expect(document.body.textContent).not.toContain('\\\\');
  });
});
