import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { accountFlagOn, decidedOn, Flag, setAccountFeatures, setFlags, useFlags } from './flags';

// BF-0462-03: one gating interface with two sources, and live reflow in both modes. Local mode's
// source is /api/status (App's poll hands each answer to setFlags); Cloud's is the account
// snapshot (CloudApp hands every account read, including the one after each `flags.changed`
// event, to setAccountFeatures). The same Gate, Flag and useFlags reflow from either.

type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const sources = (folder: string) => fs.readdirSync(`${SOURCE}${folder}/`)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => `${folder}/${name}`);

afterEach(() => {
  setAccountFeatures(null);
  setFlags({});
});

function Gated() {
  const on = useFlags();
  return (
    <>
      <Flag id="requests"><button>Requests</button></Flag>
      {on('rooms') && <a href="/rooms">Rooms</a>}
    </>
  );
}

describe('live reflow through the one read', () => {
  it('local mode: a new /api/status answer closes the page up and opens it again, without a reload', () => {
    setFlags({ requests: true, rooms: true });
    render(<Gated />);
    expect(screen.getByRole('button', { name: 'Requests' })).toBeInTheDocument();
    act(() => setFlags({ requests: false, rooms: true }));
    expect(screen.queryByRole('button', { name: 'Requests' })).toBeNull();
    act(() => setFlags({ requests: true, rooms: true }));
    expect(screen.getByRole('button', { name: 'Requests' })).toBeInTheDocument();
  });

  it('Cloud: the account read after `flags.changed` reflows the same components', () => {
    setFlags(null);
    act(() => setAccountFeatures({ rooms: true }));
    render(<Gated />);
    expect(screen.getByRole('link', { name: 'Rooms' })).toBeInTheDocument();
    act(() => setAccountFeatures({ rooms: false }));
    expect(screen.queryByRole('link', { name: 'Rooms' })).toBeNull();
    act(() => setAccountFeatures({ rooms: true }));
    expect(screen.getByRole('link', { name: 'Rooms' })).toBeInTheDocument();
  });
});

describe('the account source', () => {
  it('follows the one rule: unmentioned is on, false is off', () => {
    expect(decidedOn(null, 'rooms')).toBe(true);
    expect(decidedOn({ rooms: false }, 'rooms')).toBe(false);
    expect(decidedOn({ rooms: true }, 'rooms')).toBe(true);
  });

  it('reads the held account, or the snapshot a page was handed', () => {
    setAccountFeatures({ rooms: false });
    expect(accountFlagOn('rooms')).toBe(false);
    expect(accountFlagOn('rooms', { rooms: true })).toBe(true);
    expect(accountFlagOn('rooms', null)).toBe(true);
  });

  it('describes the account, not what the open shell can run here', () => {
    // the local-first shell switches Lucy off as a status source (no local server in the browser);
    // the plan still includes it, so plan cards and meters keep naming it
    setFlags({ lucy: false });
    setAccountFeatures({ lucy: true });
    expect(accountFlagOn('lucy')).toBe(true);
  });
});

describe('every call site uses the one read', () => {
  const files = ['cloud', 'rooms', 'views', 'shell', 'devices'].flatMap(sources);

  it('Cloud has no private feature read left (featureOn retired)', () => {
    expect(files.filter((file) => /\bfeatureOn\b/.test(fs.readFileSync(`${SOURCE}${file}`, 'utf8')))).toEqual([]);
  });

  it('nothing re-implements the default-on rule against an account by hand', () => {
    const inline = files.filter((file) => /features(\?\.)?\[[^\]]+\]\s*!==\s*false/.test(fs.readFileSync(`${SOURCE}${file}`, 'utf8')));
    expect(inline).toEqual([]);
  });
});
