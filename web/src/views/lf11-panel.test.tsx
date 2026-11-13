import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceMixRepair } from '../cloud/lf-mix-repair/DeviceMixRepair';
import type { DeviceMixReadiness, DeviceTarget, TrackReference } from '../cloud/lf-mix-repair/readiness';

const now = Date.now();
const tracks: TrackReference[] = Array.from({ length: 8 }, (_, i) => ({
  occurrenceId: `occ-${i}`, recordingId: `recording-${i}`,
  title: `Synthetic Track ${i + 1}`, explicit: false, version: 'original',
}));
const devices: DeviceTarget[] = [
  { id: 'studio', name: 'Studio speaker', connected: true, outputVerified: true },
  { id: 'remote', name: 'Remote controller', connected: true, controllerOnly: true },
];
function state(): DeviceMixReadiness {
  return {
    deviceId: 'studio', mixId: 'mix', revision: 'r1', checkedAt: now,
    localVerification: true, engineHealthy: true, outputVerified: true,
    sourceConnected: true, policyAllowed: true, playbackWindowFree: true,
    tracks: tracks.map((track, index) => ({
      occurrenceId: track.occurrenceId,
      state: index < 5 ? 'Ready' : index < 7 ? 'Missing' : 'Candidate',
      verifiedAt: now, cueValid: true, seamValid: true, previewValid: true,
      candidateId: 'wrong-version', candidateVersion: 'clean', candidateExplicit: false,
      equivalentVerified: false,
    })),
  };
}

describe('LF11 repair UI', () => {
  it('renders 5/8 with no preview, no fake action and a non-destructive temporary variation', async () => {
    const apply = vi.fn();
    const { container } = render(<DeviceMixRepair
      mixId="mix" revision="r1" tracks={tracks} devices={devices} deviceId="studio"
      onDeviceChange={() => {}} readiness={state()} onApplyVariation={apply}
    />);
    const panel = screen.getByRole('region', { name: 'Device mix readiness and repair' });
    expect(within(panel).getByText(/5\/8 exact recordings verified/)).toBeInTheDocument();
    expect(within(panel).getByText('Playable: No')).toBeInTheDocument();
    expect(within(panel).getAllByText('Missing', { exact: true })).toHaveLength(2);
    expect(within(panel).getByText('Candidate', { exact: true })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Locate local recording' })).toBeDisabled();
    expect(container.querySelector('audio, canvas')).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Create temporary playable variation' }));
    expect(within(panel).getByText(/5 verified tracks selected; 3 skipped/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Copy to editable draft' }));
    expect(apply).toHaveBeenCalledWith({
      temporary: true, fromMixId: 'mix', originalRevision: 'r1',
      orderedOccurrenceIds: tracks.slice(0, 5).map(t => t.occurrenceId),
      skippedOccurrenceIds: tracks.slice(5).map(t => t.occurrenceId),
    });
  });
  it('does not use the first device verifier for a new device or revision', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DeviceMixRepair
      mixId="mix" revision="r1" tracks={tracks} devices={devices}
      deviceId="studio" onDeviceChange={onChange} readiness={state()} />);
    rerender(<DeviceMixRepair
      mixId="mix" revision="r1" tracks={tracks} devices={devices}
      deviceId="remote" onDeviceChange={onChange} readiness={state()} />);
    expect(screen.getByText(/local verification is missing, disconnected/)).toBeInTheDocument();
    expect(screen.getByText('Playable: No')).toBeInTheDocument();
    expect(screen.getByText(/Controller-only devices cannot play/)).toBeInTheDocument();
    expect(screen.queryByText(/5\/8 exact recordings verified/)).toBeNull();
  });
  it('allows keyboard focus on the device picker and never enables unknown audio', async () => {
    render(<DeviceMixRepair mixId="mix" revision="r1" tracks={tracks}
      devices={devices} deviceId="studio" onDeviceChange={() => {}} readiness={null} />);
    const picker = screen.getByLabelText('Verify for device');
    picker.focus();
    expect(picker).toHaveFocus();
    expect(screen.getByText('Editable: Yes')).toBeInTheDocument();
    expect(screen.getByText('Auditionable: No')).toBeInTheDocument();
    expect(screen.getByText('Playable: No')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create temporary playable variation' })).toBeDisabled();
  });
});
