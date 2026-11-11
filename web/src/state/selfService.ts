/** GP-0263: the local faults Selecta can actually detect, each with the operation it affects, what is
 * known about its cause, and one scoped way to put it right. A fault is listed only when the server
 * measured it; a dependency that is present is never explained. "verified" means the cause itself
 * was measured (ffmpeg absent, drive full); "possible" means only the symptom was measured and the
 * cause is a likely reason, said as such. No repair here deletes or redoes other work. */

export type FaultArea = 'environment' | 'scan' | 'worker' | 'export';
export type Certainty = 'verified' | 'possible';
export type FaultId =
  | 'ffmpeg_missing' | 'data_readonly' | 'disk_low'
  | 'scan_failed' | 'folders_missing'
  | 'storage_full' | 'worker_stopped' | 'analysis_failed'
  | 'export_no_room' | 'export_failed' | 'export_interrupted';

export type FaultSpec = {
  area: FaultArea;
  /** what stopped or can't happen */
  operation: string;
  certainty: Certainty;
  cause: string;
  /** a scoped next step; never "reset", "clear" or "delete everything" */
  repair: string;
  to?: string;
  action?: string;
};

export const FAULT_CATALOGUE: Record<FaultId, FaultSpec> = {
  ffmpeg_missing: {
    area: 'environment', operation: 'Reading m4a and AAC songs, and separating stems', certainty: 'verified',
    cause: 'ffmpeg is not installed on this PC, or Windows can’t find it on its PATH.',
    repair: 'Install ffmpeg, make sure the ffmpeg command works in a new terminal, then restart Selecta. Other songs keep working meanwhile.',
  },
  data_readonly: {
    area: 'environment', operation: 'Saving anything Selecta makes', certainty: 'verified',
    cause: 'Selecta isn’t allowed to write to its data folder.',
    repair: 'Give your account permission to change the Selecta data folder, then choose Check again.',
  },
  disk_low: {
    area: 'environment', operation: 'Rendering transitions and saving files', certainty: 'verified',
    cause: 'The drive Selecta keeps its data on has less than 1 GB free.',
    repair: 'Free some space on that drive, or lower Selecta’s cache limit.', to: '/workshop/storage', action: 'Open Storage',
  },
  scan_failed: {
    area: 'scan', operation: 'Reading a music folder', certainty: 'verified',
    cause: 'The last folder read stopped with an error. Songs already in your library are unchanged.',
    repair: 'Read the error on Sources, fix it, and read that folder again.', to: '/workshop/sources', action: 'Open Sources',
  },
  folders_missing: {
    area: 'scan', operation: 'Finding new songs and playing songs in a missing folder', certainty: 'verified',
    cause: 'A music folder can’t be found right now, for example an unplugged drive. Its songs are kept.',
    repair: 'Plug the drive back in, or point Selecta at where the folder moved.', to: '/workshop/sources', action: 'Open Sources',
  },
  storage_full: {
    area: 'worker', operation: 'Rendering transitions', certainty: 'verified',
    cause: 'Selecta’s cache has reached its limit, so rendering waits.',
    repair: 'Raise the cache limit or let Selecta clear old transitions. Your mixes are not changed.', to: '/workshop/storage', action: 'Open Storage',
  },
  worker_stopped: {
    area: 'worker', operation: 'Rendering drafts in the render line', certainty: 'possible',
    cause: 'The rendering worker isn’t running while drafts wait. It may simply not have started yet; the reason is not confirmed.',
    repair: 'Wait a minute and choose Check again. If it still isn’t running, restart Selecta. Drafts stay in line.',
  },
  analysis_failed: {
    area: 'worker', operation: 'Analysing songs', certainty: 'possible',
    cause: 'Some songs couldn’t be analysed. A damaged file or a format Selecta can’t read is likely, but not confirmed.',
    repair: 'Look at those songs one at a time. Other songs are not affected.', to: '/library?show=attention', action: 'See those songs',
  },
  export_no_room: {
    area: 'export', operation: 'Saving a mix as a file', certainty: 'verified',
    cause: 'The drive was full when the file was being saved.',
    repair: 'Free some space, then retry that export. It saves the same mix it was started with.', to: '/workshop/storage', action: 'Open Storage',
  },
  export_failed: {
    area: 'export', operation: 'Saving a mix as a file', certainty: 'possible',
    cause: 'A file couldn’t be written. Free space or folder permissions are the usual reasons, but the cause is not confirmed.',
    repair: 'Retry that export from your mix. Nothing else is affected.',
  },
  export_interrupted: {
    area: 'export', operation: 'Saving a mix as a file', certainty: 'verified',
    cause: 'Selecta stopped while a file was being saved, so no file was kept.',
    repair: 'Retry that export from your mix. It saves the same mix it was started with.',
  },
};

export type DetectedFault = FaultSpec & { id: FaultId; count?: number };

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Only what the server measured. An unknown or missing field is not a fault, and a check that came
 * back fine says nothing at all. */
export function detectFaults(info: Record<string, unknown>): DetectedFault[] {
  const checks = record(info.checks);
  const exports = record(info.exports);
  const found: DetectedFault[] = [];
  const add = (id: FaultId, how = 0) => found.push({ id, ...FAULT_CATALOGUE[id], ...(how ? { count: how } : {}) });
  if (checks.ffmpeg === false) add('ffmpeg_missing');
  if (checks.data_writable === false) add('data_readonly');
  if (checks.disk_low === true) add('disk_low');
  if (info.scan_failed === true) add('scan_failed');
  if (count(info.folders_missing)) add('folders_missing', count(info.folders_missing));
  if (info.storage_full === true) add('storage_full');
  if (info.worker_running === false && count(info.drafts_in_line)) add('worker_stopped');
  if (count(info.analysis_failures)) add('analysis_failed', count(info.analysis_failures));
  if (count(exports.failed_no_room)) add('export_no_room', count(exports.failed_no_room));
  if (count(exports.failed)) add('export_failed', count(exports.failed));
  if (count(exports.interrupted)) add('export_interrupted', count(exports.interrupted));
  return found;
}

export const AREA_WORDS: Record<FaultArea, string> = {
  environment: 'This PC',
  scan: 'Reading folders',
  worker: 'Background work',
  export: 'Saving files',
};
