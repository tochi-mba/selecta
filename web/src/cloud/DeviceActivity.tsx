import { useEffect, useState } from 'react';
import { beatModelNow, onBeatModel } from '../dsp/analysis/beatThis/gate';
import { flagOn } from '../flags';
import { ActivityPanel } from '../ui/ActivityPanel';
import { ExportJobs } from '../views/ExportJobs';
import { Drawer } from '../ui/controls';
import type { StudioActivity } from './deviceStudio';
import { uploadActivity, type UploadActivity } from './factsUploader';
import { onStudios, studioOf } from './studioWiring';
import { onTonalActivity, timingBeats, tonalActivity, tonalLeft, type TonalActivity } from './tonalActivity';

/** The Activity drawer of the browser shell (T-20261126-36c7): what this device is doing, above
 * the changes that can be undone. Each line is read from the module doing the work (the song
 * measuring, the uploader, the studio making transitions, the beat finder's download), never by
 * asking the server, and shown only while there is something to say. */

export type DeviceWork = {
  measuring: TonalActivity;
  left: number;
  timing: boolean;
  upload: UploadActivity;
  studio: StudioActivity | null;
  model: { received: number; total: number } | null;
};

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** The lines, in the drawer's own words. */
export function deviceWorkLines(work: DeviceWork, titleOf: (songId: number) => string | null): string[] {
  const lines: string[] = [];
  if (work.model) {
    const share = work.model.total > 0 ? Math.min(100, Math.round((work.model.received / work.model.total) * 100)) : 0;
    lines.push(`Downloading the beat finder to this device: ${share}%.`);
  }
  if (work.measuring === 'measuring') {
    lines.push(work.left > 0 ? `Measuring songs on this device: ${plural(work.left, 'song')} to go.` : 'Measuring songs on this device.');
    if (work.timing) lines.push('Timing the beat finder on this device with the song being measured.');
  } else if (work.measuring === 'waiting_music' || work.measuring === 'waiting_import') {
    const when = work.measuring === 'waiting_music' ? 'when the music stops' : 'when adding music finishes';
    lines.push(`Measuring songs carries on ${when}${work.left > 0 ? `: ${plural(work.left, 'song')} to go` : ''}.`);
  }
  if (work.upload.saving) lines.push('Saving song measurements to your account.');
  else if (work.upload.saved > 0) lines.push(`Saved measurements of ${plural(work.upload.saved, 'song')} to your account on this visit.`);
  const making = work.studio?.making;
  if (making) {
    const from = titleOf(making.a);
    const into = titleOf(making.b);
    const which = making.forRequest ? ' for a request' : '';
    lines.push(from && into ? `Preparing the transition from ${from} into ${into}${which}.` : `Preparing a transition${which || ' in your mix'}.`);
  }
  if (work.studio && work.studio.waiting > 0) lines.push(`${plural(work.studio.waiting, 'more transition')} to prepare.`);
  if (work.studio && !making && work.studio.made > 0) lines.push(`${plural(work.studio.made, 'transition')} prepared on this device on this visit.`);
  return lines;
}

/** The work as it stands, kept current from each module's own state. */
export function useDeviceWork(workspaceId: string): DeviceWork {
  const read = (): DeviceWork => {
    const model = beatModelNow()?.state.get();
    return {
      measuring: tonalActivity(),
      left: tonalLeft(),
      timing: timingBeats(),
      upload: uploadActivity.get(),
      studio: studioOf(workspaceId)?.state.get() ?? null,
      model: model?.kind === 'downloading' ? { received: model.received, total: model.total } : null,
    };
  };
  const [work, setWork] = useState(read);
  useEffect(() => {
    const again = () => setWork(read());
    let studioOff = () => {};
    let modelOff = () => {};
    const follow = () => {
      studioOff();
      modelOff();
      studioOff = studioOf(workspaceId)?.state.subscribe(again) ?? (() => {});
      modelOff = beatModelNow()?.state.subscribe(again) ?? (() => {});
      again();
    };
    follow();
    const offs = [onTonalActivity(again), uploadActivity.subscribe(again), onStudios(follow), onBeatModel(follow)];
    return () => {
      for (const off of offs) off();
      studioOff();
      modelOff();
    };
  }, [workspaceId]);
  return work;
}

/** The device's lines, in the Activity list's own row format. */
export function DeviceWorkRows({ workspaceId, titleOf }: { workspaceId: string; titleOf: (songId: number) => string | null }) {
  const lines = deviceWorkLines(useDeviceWork(workspaceId), titleOf);
  if (!lines.length) return null;
  return (
    <section className="activity" aria-label="On this device">
      <ul className="activity-list">
        {lines.map((line) => (
          <li key={line} className="activity-row neutral">
            <div><p>{line}</p><small className="soft">On this device</small></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Activity drawer: this device's work, the recent changes with their Undo, and the mixes
 * being saved as files here. */
export function DeviceActivityDrawer({ workspaceId, titleOf, onClose }: { workspaceId: string; titleOf: (songId: number) => string | null; onClose: () => void }) {
  const activity = flagOn('app.activity');
  return (
    <Drawer title={activity ? 'Activity' : 'Exports'} onClose={onClose}>
      {activity && <DeviceWorkRows workspaceId={workspaceId} titleOf={titleOf} />}
      {activity && <ActivityPanel />}
      {flagOn('export') && <ExportJobs />}
    </Drawer>
  );
}
