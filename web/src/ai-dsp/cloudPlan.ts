/**
 * Cloud Lucy sends untrusted suggestions only. No browser audio, lyrics, PCM, source
 * paths, stems, model outputs or file handles enter this contract.
 */
export type LocalCapability = "metadata" | "beat_grid" | "time_stretch" | "blend" | "echo";
export interface PlanScope {
  readonly workspaceId: string; readonly deviceId: string;
  readonly actorId: string; readonly generation: number; readonly recipeRevision: string;
}
export interface SuggestedAction {
  readonly op: "suggest_order" | "suggest_transition" | "explain";
  readonly recording_ids: readonly string[];
  readonly transition: "cut" | "beatmatch" | "blend" | "fade" | "echo_out" | null;
  readonly note: string;
}
export interface CloudPlan {
  readonly schema_version: 1;
  readonly workspace_id: string; readonly device_id: string;
  readonly availability: "unverified";
  readonly steps: readonly SuggestedAction[];
}
const exactKeys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).length === names.length &&
  Object.keys(value).every(key => names.includes(key));
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const unsafeText = (text: string) => /(?:<|>|https?:\\/\\/|file:\\/\\/|[A-Za-z]:[\\\\/]|\\/(?:home|Users|mnt|tmp|var|media)\\/|\\bignore\\s+(?:all\\s+)?(?:previous|system)\\s+instructions|[A-Za-z0-9+/]{160,})/i.test(text);
const transitions = ["cut", "beatmatch", "blend", "fade", "echo_out"];
const operations = ["suggest_order", "suggest_transition", "explain"];
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function parseCloudPlan(raw: unknown): CloudPlan {
  if (!isObject(raw) || !exactKeys(raw, ["schema_version","workspace_id","device_id","summary","source","availability","steps"]) ||
      raw.schema_version !== 1 || typeof raw.workspace_id !== "string" ||
      typeof raw.device_id !== "string" || !idPattern.test(raw.workspace_id) ||
      !idPattern.test(raw.device_id) || raw.availability !== "unverified" ||
      typeof raw.summary !== "string" || raw.summary.length > 320 || unsafeText(raw.summary) ||
      (raw.source !== "hosted" && raw.source !== "builtin") ||
      !Array.isArray(raw.steps) || raw.steps.length > 12) throw new Error("invalid_cloud_plan");
  const steps: SuggestedAction[] = [];
  for (const entry of raw.steps) {
    if (!isObject(entry) || !exactKeys(entry, ["op","recording_ids","transition","note"]) ||
        !operations.includes(entry.op as string) || !Array.isArray(entry.recording_ids) ||
        entry.recording_ids.length > 32 || entry.recording_ids.some(v => typeof v !== "string" || !idPattern.test(v)) ||
        new Set(entry.recording_ids).size !== entry.recording_ids.length ||
        (entry.transition !== null && !transitions.includes(entry.transition as string)) ||
        typeof entry.note !== "string" || entry.note.length > 240 || unsafeText(entry.note) ||
        (entry.op === "explain" && entry.recording_ids.length !== 0) ||
        (entry.op === "suggest_transition" && entry.recording_ids.length !== 2)) {
      throw new Error("invalid_cloud_action");
    }
    steps.push({
      op: entry.op as SuggestedAction["op"],
      recording_ids: [...entry.recording_ids] as string[],
      transition: entry.transition as SuggestedAction["transition"],
      note: entry.note
    });
  }
  return {schema_version:1, workspace_id:raw.workspace_id, device_id:raw.device_id,
    availability:"unverified", steps};
}
export function requiredLocalCapabilities(action: SuggestedAction): readonly LocalCapability[] {
  if (action.op === "explain" || action.op === "suggest_order") return ["metadata"];
  switch (action.transition) {
    case "beatmatch": return ["beat_grid", "time_stretch"];
    case "blend": return ["blend"];
    case "echo_out": return ["echo"];
    default: return ["metadata"];
  }
}
export interface LocalPlanAuthority {
  readonly scope: PlanScope;
  hasCapability(cap: LocalCapability): boolean;
  isExactRecordingReady(recordingId: string): boolean;
  /** Browser host authorises each proposed edit independently, never an AI instruction. */
  authoriseProposal(action: SuggestedAction, scope: PlanScope): boolean;
}
export type PlanPreflight = { status:"eligible"; actions: readonly SuggestedAction[] } |
  { status:"scope_denied" | "source_missing" | "capability_missing" | "permission_denied"; actions: readonly [] };
/** No apply/tool callbacks: a separate owner must revalidate revision, actor and approval at commit time. */
export function preflightCloudPlan(raw: unknown, authority: LocalPlanAuthority): PlanPreflight {
  const plan = parseCloudPlan(raw);
  const scope = authority.scope;
  if (!scope.actorId || !scope.recipeRevision || !Number.isSafeInteger(scope.generation) ||
      scope.generation < 0 || plan.workspace_id !== scope.workspaceId || plan.device_id !== scope.deviceId) {
    return {status:"scope_denied", actions:[]};
  }
  for (const action of plan.steps) {
    if (action.recording_ids.some(id => !authority.isExactRecordingReady(id))) return {status:"source_missing",actions:[]};
    if (requiredLocalCapabilities(action).some(cap => !authority.hasCapability(cap))) return {status:"capability_missing",actions:[]};
    if (!authority.authoriseProposal(action, scope)) return {status:"permission_denied",actions:[]};
  }
  return {status:"eligible", actions:plan.steps};
}
