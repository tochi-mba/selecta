import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setFlags } from '../flags';
import { detectFaults, FAULT_CATALOGUE, FaultArea } from '../state/selfService';
import { fakeBackend } from '../test/backend';
import { Diagnostics, safeDiagnostics } from './WorkshopPanels';

/** GP-0263-01/02/04/06: Workspace lists only the faults the server measured, across environment,
 * scan, worker and export, says whether each cause is confirmed or only likely, gives one scoped
 * step that deletes nothing else, and explains a local dependency only when it is missing. */

afterEach(() => setFlags(null));

const everything = {
  worker_running: false,
  drafts_in_line: 2,
  analysis_failures: 3,
  scan_failed: true,
  folders_missing: 1,
  storage_full: true,
  checks: { ffmpeg: false, data_writable: false, disk_low: true },
  exports: { failed: 1, failed_no_room: 1, interrupted: 1 },
};
const healthy = {
  worker_running: true,
  drafts_in_line: 0,
  analysis_failures: 0,
  scan_failed: false,
  folders_missing: 0,
  storage_full: false,
  checks: { ffmpeg: true, data_writable: true, disk_low: false },
  exports: { failed: 0, failed_no_room: 0, interrupted: 0 },
};

describe('GP-0263-01 a catalogue of actual faults', () => {
  it('covers environment, scan, worker and export failures, each with the operation it stops', () => {
    const areas = new Set(Object.values(FAULT_CATALOGUE).map((fault) => fault.area));
    expect([...areas].sort()).toEqual((['environment', 'export', 'scan', 'worker'] as FaultArea[]).sort());
    for (const fault of Object.values(FAULT_CATALOGUE)) {
      expect(fault.operation.length).toBeGreaterThan(5);
      expect(fault.cause.length).toBeGreaterThan(10);
      expect(fault.repair.length).toBeGreaterThan(10);
    }
  });

  it('every catalogued fault is reachable from a measured server field, and a healthy PC lists none', () => {
    expect(detectFaults(everything).map((fault) => fault.id).sort()).toEqual(Object.keys(FAULT_CATALOGUE).sort());
    expect(detectFaults(healthy)).toEqual([]);
  });

  it('an older server without the checks lists nothing it did not measure', () => {
    expect(detectFaults({ api_version: 2, worker_running: true })).toEqual([]);
    expect(detectFaults({ checks: 'C:/odd', exports: [1], folders_missing: 'many' })).toEqual([]);
  });

  it('Diagnostics shows each detected fault with its area and count', async () => {
    fakeBackend({ 'GET /diagnostics': everything });
    render(<Diagnostics />);
    const section = within((await screen.findByRole('heading', { name: 'What went wrong' })).closest('section')!);
    expect(section.getAllByRole('listitem')).toHaveLength(Object.keys(FAULT_CATALOGUE).length);
    expect(section.getByText(/Background work: Analysing songs \(3\)/)).toBeInTheDocument();
    expect(section.getByText(/Reading folders: Reading a music folder/)).toBeInTheDocument();
  });

  it('a healthy PC says nothing is wrong, and the flag off removes the section', async () => {
    fakeBackend({ 'GET /diagnostics': healthy });
    const { unmount } = render(<Diagnostics />);
    expect(await screen.findByText('Nothing SelectaDJ checks for is wrong right now.')).toBeInTheDocument();
    unmount();
    setFlags({ 'workspace.self_service': false });
    fakeBackend({ 'GET /diagnostics': everything });
    render(<Diagnostics />);
    expect(await screen.findByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What went wrong' })).toBeNull();
  });
});

describe('GP-0263-02 confirmed cause versus likely cause', () => {
  it('a verified cause states a measured fact, a possible one says it is not confirmed', () => {
    for (const fault of Object.values(FAULT_CATALOGUE)) {
      if (fault.certainty === 'verified') expect(fault.cause).not.toMatch(/\b(may|might|likely|usual|probably|not confirmed)\b/i);
      else expect(fault.cause).toMatch(/not confirmed/i);
    }
  });

  it('the page labels each one differently', async () => {
    fakeBackend({ 'GET /diagnostics': { checks: { ffmpeg: true, data_writable: true, disk_low: false }, exports: { failed: 1, failed_no_room: 1, interrupted: 0 } } });
    const { container } = render(<Diagnostics />);
    await screen.findByRole('heading', { name: 'What went wrong' });
    const full = container.querySelector('[data-fault="export_no_room"]')!;
    const unknown = container.querySelector('[data-fault="export_failed"]')!;
    expect(full).toHaveAttribute('data-certainty', 'verified');
    expect(full.textContent).toMatch(/Confirmed cause: The drive was full/);
    expect(unknown).toHaveAttribute('data-certainty', 'possible');
    expect(unknown.textContent).toMatch(/Possible cause, not confirmed:/);
  });
});

describe('GP-0263-04 scoped repair that deletes nothing else', () => {
  it('no repair resets, clears or deletes other work, and each says what stays', () => {
    for (const fault of Object.values(FAULT_CATALOGUE)) {
      expect(fault.repair).not.toMatch(/\b(reset|delete|remove all|clear (your|the) library|start over|reinstall selecta)\b/i);
      if (fault.to) expect(fault.to).toMatch(/^\/(workshop\/(storage|sources)|library\?show=attention)$/);
    }
    expect(FAULT_CATALOGUE.scan_failed.cause).toMatch(/already in your library are unchanged/);
    expect(FAULT_CATALOGUE.export_no_room.repair).toMatch(/same mix it was started with/);
    expect(FAULT_CATALOGUE.analysis_failed.repair).toMatch(/Other songs are not affected/);
  });
});

describe('GP-0263-06 only detected dependency requirements', () => {
  it('a present ffmpeg is not explained anywhere on the page', async () => {
    fakeBackend({ 'GET /diagnostics': healthy });
    render(<Diagnostics />);
    const section = (await screen.findByRole('heading', { name: 'What went wrong' })).closest('section')!;
    expect(section.textContent).not.toMatch(/ffmpeg|install/i);
    expect(document.querySelector('.diagnostic-facts')!.textContent).not.toMatch(/ffmpeg|install/i);
    // only the raw copied details record the check itself, as a plain true
    expect(document.querySelector('pre.diagnostics')!.textContent).toMatch(/"ffmpeg": true/);
  });

  it('a missing ffmpeg is explained, with what still works', async () => {
    fakeBackend({ 'GET /diagnostics': { ...healthy, checks: { ...healthy.checks, ffmpeg: false } } });
    const { container } = render(<Diagnostics />);
    await screen.findByRole('heading', { name: 'What went wrong' });
    const item = container.querySelector('[data-fault="ffmpeg_missing"]')!;
    expect(item.textContent).toMatch(/Confirmed cause: ffmpeg is not installed/);
    expect(item.textContent).toMatch(/Other songs keep working/);
    expect(container.querySelectorAll('[data-fault]')).toHaveLength(1);
  });

  it('copied diagnostics keep the checks as booleans and counts only', () => {
    const copied = safeDiagnostics({
      checks: { ffmpeg: false, data_writable: 'C:/Users/someone', extra: true },
      exports: { failed: 2, failed_no_room: 'Private Title', path: 'C:/x' },
      scan_failed: true,
      folders_missing: 1,
    });
    expect(copied.checks).toEqual({ ffmpeg: false });
    expect(copied.exports).toEqual({ failed: 2 });
    expect(copied.scan_failed).toBe(true);
    expect(JSON.stringify(copied)).not.toMatch(/someone|Private|C:/);
  });
});
