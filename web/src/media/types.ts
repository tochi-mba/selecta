/** Browser-private media contracts. None of these objects may be sent to Cloud. */
export type MediaReadiness =
  | 'ready' | 'candidate' | 'missing' | 'version_mismatch'
  | 'permission_required' | 'unsupported_codec' | 'source_disconnected' | 'unknown';
export type MediaOrigin = 'file_input' | 'folder_input' | 'directory_picker' | 'drop' | 'document_provider';
export type RecordingIdentity = {
  /** Opaque local token; NOT the Cloud canonical track ID. */
  localId: string;
  /** Exact SHA-256 of the complete file only when verified, never upload this field. */
  exactSha256: string | null;
  bytes: number;
  lastModified: number;
};
export type LocalRecording = {
  id: string;
  sourceId: string;
  title: string;
  artist: string | null;
  displayName: string;
  mime: string;
  durationSeconds: number | null;
  identity: RecordingIdentity;
  readiness: MediaReadiness;
  reason: string;
  canonicalTrackId: string | null;
  /** A local-only version hint. Never infer two different masters are exact matches. */
  version: string | null;
};
export type LocalSource = {
  id: string;
  label: string;
  origin: MediaOrigin;
  count: number;
  state: MediaReadiness | 'scanning';
  checkedAt: number | null;
};
export type MediaScanProgress = { scanned: number; total: number; sourceId: string; cancelled: boolean };
export type ExpectedRecording = {
  canonicalTrackId: string;
  exactSha256?: string | null; // only from an authorised, local private reference
  bytes?: number | null;
  title?: string | null;
  version?: string | null;
};
export type MediaResolution = {
  state: MediaReadiness;
  localRecordingId: string | null;
  canonicalTrackId: string;
  reason: string;
};
/** Sanitised metadata-only control-plane shape for Agent 06. Never append file paths, identifiers or hashes. */
export type BrowserAvailabilitySummary = {
  schema_version: 1;
  device_role: 'browser_player';
  checked_at: string;
  total: number;
  states: Record<MediaReadiness, number>;
  browser_session_active: boolean;
  audio_output_verified: false;
};
export const READINESS_LABELS: Record<MediaReadiness, string> = {
  ready: 'Ready', candidate: 'Candidate', missing: 'Missing',
  version_mismatch: 'Version mismatch', permission_required: 'Permission required',
  unsupported_codec: 'Unsupported codec', source_disconnected: 'Source disconnected',
  unknown: 'Unknown',
};
