import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, Reply, status } from '../test/backend';
import { SetPlayer } from '../player';
import { RenameDraft } from './Drafts';
import { Listening } from './Listening';
import { LucySettings } from './LucySettings';
import { Workshop } from './Workshop';

/**
 * T0043 (docs/engineering/form-validation-audit.md): a field that is wrong says so on the field itself,
 * so a screen reader hears the reason when it lands there, not only in a separate alert.
 */

// Vitest hands back no CSS, and these source checks read files from disk as css-ownership.test.ts does.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;

describe('form validation audit (T0043)', () => {
  it('every control marked invalid in the app also points at the words that say why', () => {
    const files = fs.readdirSync(SOURCE, { recursive: true }).map((name) => name.replace(/\\/g, '/'))
      .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'));
    const missing: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(SOURCE + file, 'utf8').split('\n');
      lines.forEach((line, at) => {
        if (!line.includes('aria-invalid')) return;
        const near = lines.slice(Math.max(0, at - 3), at + 4).join('\n');
        if (!near.includes('aria-describedby')) missing.push(`${file}:${at + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it('a draft name that will not save is tied to the name box', async () => {
    fakeBackend({ 'POST /drafts/1/name': new Reply(400, { detail: 'That name is too long.' }) });
    render(<RenameDraft id={1} name="Draft 1" onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    const alert = await screen.findByRole('alert');
    const box = screen.getByRole('textbox', { name: 'Name this draft' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(alert.textContent ?? '');
  });

  it('a study that will not open marks the study code, not just the page', async () => {
    fakeBackend({ 'GET /listening': new Reply(404, { detail: 'Not Found' }) });
    render(<Listening />);
    fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'ear' } });
    fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    await screen.findByRole('alert');
    const code = screen.getByRole('textbox', { name: 'Study code' });
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription(/Could not load this listening study\. Check the study code/);
  });

  it('Lucy’s limits name the rule broken on the field that broke it', () => {
    const lucy = {
      enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
      provider: { kind: 'builtin', label: 'Built-in', model: null, base_url: null, remote: false, consented: false, key_set: false, mode: 'full', reason: null, capabilities: { streaming: true, tools: true, json_schema: false, context_tokens: null, cancellation: true } },
      budgets: { max_cycles: 6, max_steps: 40, max_seconds: 120, max_output_tokens: 4000, spend_cap_usd: null },
      privacy: { share_lyrics: false, share_history: false, data_classes: [] }, event_schema: 1, api_version: 1,
    };
    render(<LucySettings status={lucy as never} onSaved={vi.fn()} />);
    const steps = screen.getByLabelText('Most steps per request');
    expect(steps).toHaveAccessibleDescription('Searches, checks and plans Lucy may run for one request.');
    fireEvent.change(steps, { target: { value: '0' } });
    expect(steps).toHaveAttribute('aria-invalid', 'true');
    expect(steps).toHaveAccessibleDescription(/Use a whole number above zero for: Most steps per request\./);
    const cap = screen.getByLabelText('Spending limit in US dollars (optional)');
    fireEvent.change(cap, { target: { value: '-1' } });
    expect(cap).toHaveAttribute('aria-invalid', 'true');
    expect(cap).toHaveAccessibleDescription(/The spending limit has to be a number of dollars, or empty\./);
  });

  it('a refused storage limit is tied to the slider', async () => {
    const GB = 1024 ** 3;
    fakeBackend({
      'GET /storage': { used_bytes: 4.2 * GB, kept_bytes: 3.2 * GB, cache_bytes: 1 * GB, free_bytes: 13 * GB, budget_bytes: 3 * GB, largest_budget_bytes: 13 * GB, smallest_budget_bytes: 0.5 * GB, total_bytes: 200 * GB },
      'POST /storage': new Reply(400, { detail: 'There isn’t that much room.' }),
    });
    const player = new SetPlayer(() => [], () => {});
    render(<Workshop tab="storage" status={status({})} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />);
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '9' } });
    await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(slider).toHaveAttribute('aria-invalid', 'true');
    expect(slider).toHaveAccessibleDescription('There isn’t that much room. The limit is still 3.0 GB.');
  });
});
