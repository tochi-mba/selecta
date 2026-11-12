import type { LucyStatus } from '../lucy/types';
import { PageLink } from '../shell/PageLink';
import { Action } from '../ui/controls';
import { words } from '../copy';

/** Why Lucy can't be used right now, and the way forward. Make a Mix is always one press away, because
 * nothing about Lucy being off or unavailable ever stops a normal mix. */

export type Gate = 'loading' | 'old' | 'off' | 'consent' | 'unavailable' | 'open';

export function gateOf(status: LucyStatus | null, missing: boolean): Gate {
  if (missing) return 'old';
  if (!status) return 'open';
  if (!status.enabled) return 'off';
  if (status.provider.kind !== 'builtin' && status.provider.remote && !status.provider.consented) return 'consent';
  if (status.provider.mode === 'unavailable') return 'unavailable';
  return 'open';
}

/** Why nothing can be sent, or an empty string when it can. */
export function blockedWords(gate: Gate, status: LucyStatus | null, offline: boolean): string {
  if (!status) return offline ? 'Can’t reach SelectaDJ right now. Anything you type is kept.' : 'Couldn’t check whether Lucy is on. Try again in a moment.';
  if (gate === 'consent') return `Lucy needs your OK before it sends anything to ${status.provider.label}.`;
  if (gate === 'unavailable') return `${status.provider.label} isn’t available right now.`;
  if (!status.phases.chat) return 'Chat is turned off in Lucy’s settings.';
  return '';
}

export function LucyClosed({ gate, onTurnOn, onSettings }: { gate: 'old' | 'off'; onTurnOn: () => Promise<void>; onSettings: () => void }) {
  if (gate === 'old') {
    return (
      <section className="lucy-gate">
        <h2>Lucy isn’t part of this version of SelectaDJ</h2>
        <p>Everything else works as usual. Make a Mix has every way to start a mix.</p>
        <PageLink to="/mixes" className="button primary">Go to Make a Mix</PageLink>
      </section>
    );
  }
  return (
    <section className="lucy-gate">
      <h2>Lucy is turned off</h2>
      <p>Lucy is optional. Make a Mix works exactly the same without it, and turning Lucy on or off never changes your mixes or your music.</p>
      <div className="row wrap">
        <PageLink to="/mixes" className="button primary">Go to Make a Mix</PageLink>
        <Action working="Turning on…" run={onTurnOn}>Turn Lucy on</Action>
        <button type="button" onClick={onSettings}>Settings</button>
      </div>
    </section>
  );
}

export function LucyNotice({ gate, status, onBuiltin, onSettings }: { gate: Gate; status: LucyStatus; onBuiltin: () => Promise<void>; onSettings: () => void }) {
  if (gate !== 'consent' && gate !== 'unavailable') return null;
  return (
    <div className="lucy-notice" role="region" aria-label={gate === 'consent' ? 'Before Lucy can start' : 'Lucy’s planner isn’t available'}>
      {gate === 'consent' ? (
        <p><b>Lucy is set to use {status.provider.label}, {words().lucyRunsOutside}</b> Nothing is sent until you agree to exactly what would be sent.</p>
      ) : (
        <p><b>{status.provider.label} isn’t available right now{status.provider.reason ? `: ${status.provider.reason}` : '.'}</b> Make a Mix still works as usual.</p>
      )}
      <div className="row wrap">
        <Action className="primary" working="Switching…" run={onBuiltin}>Use the built-in planner instead</Action>
        <button type="button" onClick={onSettings}>{gate === 'consent' ? 'Review what’s sent' : 'Settings'}</button>
        <PageLink to="/mixes" className="button">Back to Make a Mix</PageLink>
      </div>
      <p className="hint">{words().lucyBuiltinStays}</p>
    </div>
  );
}

export function ProviderNote({ status, onSettings }: { status: LucyStatus; onSettings: () => void }) {
  const builtin = status.provider.kind === 'builtin';
  return (
    <p className="hint lucy-provider">
      {builtin
        ? words().lucyUsingBuiltin
        : `Using ${status.provider.label}${status.provider.model ? ` (${status.provider.model})` : ''}.`}
      {status.provider.mode === 'constrained' && ` Working in a simpler mode${status.provider.reason ? `: ${status.provider.reason.replace(/[.\s]+$/, '')}` : ''}.`}
      {' '}<button type="button" className="lucy-link" onClick={onSettings}>{builtin ? 'Choose an AI service' : 'Change'}</button>
    </p>
  );
}
