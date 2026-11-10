import { describe, expect, it } from 'vitest';
import type { ExportJobState } from '../api';
import { seamStatusWords } from '../lib';
import { exportStage } from '../views/ExportJobs';
import { RequestRow, requestWords } from '../views/Requests';

/**
 * S4-0095-01: docs/engineering/state-transitions.md is the per-domain state table. Every label row
 * there is checked against the code that writes the words, and every state the code knows is in the
 * table, so the document and the site cannot disagree.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const doc = fs.readFileSync(`${node.cwd()}/../docs/engineering/state-transitions.md`, 'utf8');

function table(heading: string): Record<string, string> {
  const section = doc.split(`## ${heading}`)[1].split('\n## ')[0];
  return Object.fromEntries(section.split('\n')
    .filter((line) => /^\| `[a-z_]+` \|/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map((cells) => [cells[1].replace(/`/g, ''), cells[3]]));
}

const row = (more: Partial<RequestRow> = {}): RequestRow => ({ id: 1, song_id: 2, title: 'Wanted', artist: 'A', status: 'waiting', available: 1, ...more });

describe('S4-0095-01 state tables match the words on screen', () => {
  it('transition render states', () => {
    const rows = table('Transition render (seam)');
    expect(Object.keys(rows).sort()).toEqual(['failed', 'none', 'queued', 'ready', 'rendering']);
    for (const [state, label] of Object.entries(rows)) expect(seamStatusWords(state, true), state).toBe(label);
    expect(seamStatusWords('ready', false)).toBe('Ready, with a warning');
  });

  it('export job states, and an unknown one never reads as ready', () => {
    const rows = table('Export job');
    const states: ExportJobState[] = ['preparing', 'encoding', 'ready', 'failed', 'cancelling', 'cancelled', 'interrupted', 'expired'];
    expect(Object.keys(rows).sort()).toEqual([...states].sort());
    for (const [state, label] of Object.entries(rows)) expect(exportStage({ state: state as ExportJobState }).words, state).toBe(label);
    expect(exportStage({ state: 'from_the_future' as ExportJobState }).words).toBe('State unknown');
  });

  it('song request stages', () => {
    const rows = table('Song request');
    expect(Object.keys(rows)).toHaveLength(12);
    for (const [stage, label] of Object.entries(rows)) {
      expect(requestWords(row(), stage as Parameters<typeof requestWords>[1]).label, stage).toBe(label);
    }
  });

  it('no request label promises a play time', () => {
    for (const stage of Object.keys(table('Song request'))) {
      const words = requestWords(row({ seconds: 120, after: 'Before' }), stage as Parameters<typeof requestWords>[1]);
      expect(`${words.label} ${words.detail}`, stage).not.toMatch(/will play at|plays at|scheduled for|guaranteed to play/i);
    }
  });
});
