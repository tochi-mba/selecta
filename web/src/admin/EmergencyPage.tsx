import { useState } from 'react';
import { when } from './adminApi';
import { useLoad } from './parts';
import { ActionButton, REASONS, useConsole, write } from './safety';
import { Badge, Empty, Problem, Section, Skeleton, Time } from './ui';

type ControlState = { target: string; engaged: boolean; reason: string; changed_at: number; release_action_id: string | null };
type Control = { control: string; description: string; targets: string[]; states: ControlState[] };

const NAMES: Record<string, string> = {
  'uploads.paused': 'Pause uploads', 'admission.paused': 'Pause new jobs in a pool', 'workers.drained': 'Drain workers',
  'speculative.disabled': 'Stop speculative work', 'lucy.disabled': 'Disable Lucy', 'lucy.deployment_disabled': 'Disable one Lucy model',
  'billing.safe_mode': 'Billing safe mode', 'app.read_only': 'Read-only app', 'signups.disabled': 'Stop sign-ups',
};

/** Emergency controls, one row per control with its targets (doc 07b §7B.4, System and Emergency). */
export function EmergencyPage() {
  return <div className="admin-page"><EmergencyControls /></div>;
}

export function EmergencyControls({ only }: { only?: string[] }) {
  const ctx = useConsole();
  const controls = useLoad(() => ctx.api<{ controls: Control[] }>('/admin/emergency'), [ctx.api]);
  const list = (controls.data?.controls ?? []).filter((c) => !only || only.includes(c.control));
  const engaged = list.flatMap((c) => c.states.filter((s) => s.engaged).map((s) => ({ c, s })));
  const engage = (control: Control, target: string) => ctx.ask({
    action: 'emergency.engage', title: `${NAMES[control.control] ?? control.control}${target === '*' ? ' everywhere' : ` for ${target}`}`,
    button: `Engage ${NAMES[control.control] ?? control.control}`,
    consequences: [control.description, target === '*' ? 'It applies to every customer and pool at once.' : `It applies to the ${target} pool only.`, 'Every Owner is alerted at once.', 'Releasing it later waits 15 minutes.'],
    confirmText: control.control, confirmLabel: `Type ${control.control} to confirm`, reasons: REASONS.incident, irreversible: false,
    run: async (reason, confirm) => {
      await write(ctx.api, { path: `/admin/emergency/${control.control}/engage`, body: { reason, target, confirm } });
      ctx.toast({ text: `${NAMES[control.control] ?? control.control} is engaged.`, tone: 'ok' });
      await controls.reload();
    },
    done: 'Engaged.',
  });
  const release = (control: Control, target: string) => ctx.ask({
    action: 'emergency.release', title: `Release ${NAMES[control.control] ?? control.control}`,
    button: `Queue the release of ${NAMES[control.control] ?? control.control}`,
    consequences: ['The control turns off after a 15 minute wait, unless someone cancels it.', 'Every Owner is told now and when it runs.'],
    confirmText: control.control, confirmLabel: `Type ${control.control} to confirm`, reasons: ['Incident resolved', 'Maintenance finished'], irreversible: false, delayed: true,
    run: async (reason, confirm) => {
      const done = await write<{ action?: { execute_after: number } }>(ctx.api, { path: `/admin/emergency/${control.control}/release`, body: { reason, target, confirm } });
      ctx.toast({ text: `Release queued: it runs after ${when(done.action?.execute_after)} unless cancelled.`, tone: 'ok' });
      await controls.reload();
    },
    done: 'Queued.',
  });
  return (
    <>
      <Problem error={controls.error} onRetry={() => void controls.reload()} />
      <Section title="In force now" tour="emergency-state">
        {!controls.data && !controls.error ? <Skeleton rows={2} /> : engaged.length === 0
          ? <Empty title="All emergency controls are off.">That is the normal state. During an incident, engage the narrowest control below that stops the harm.</Empty>
          : <ul className="admin-list">{engaged.map(({ c, s }) => <li key={`${c.control}${s.target}`}><Badge tone="bad">On</Badge> {NAMES[c.control] ?? c.control}{s.target === '*' ? '' : ` (${s.target})`}, since <Time at={s.changed_at} />: {s.reason}{s.release_action_id && <Badge tone="warn">Release waiting</Badge>}</li>)}</ul>}
      </Section>
      <Section title="Controls" tour="emergency-controls" help="Engaging is instant and alerts every Owner; you type the control's name to confirm. Releasing waits 15 minutes and can be cancelled.">
        <ul className="admin-controls">{list.map((control) => (
          <li key={control.control}>
            <div><strong>{NAMES[control.control] ?? control.control}</strong> <code className="admin-soft">{control.control}</code><p>{control.description}</p></div>
            <ControlTargets control={control} onEngage={engage} onRelease={release} />
          </li>
        ))}</ul>
      </Section>
    </>
  );
}

function ControlTargets({ control, onEngage, onRelease }: { control: Control; onEngage: (c: Control, t: string) => void; onRelease: (c: Control, t: string) => void }) {
  const [target, setTarget] = useState(control.targets[0] ?? '*');
  const state = control.states.find((s) => s.target === target);
  const on = state?.engaged ?? false;
  const label = (t: string) => (t === '*' ? 'Everywhere' : t);
  return (
    <div className="admin-control-target" data-tour="emergency-release">
      {control.targets.length > 1
        ? <label>Where<select value={target} onChange={(event) => setTarget(event.target.value)}>{control.targets.map((t) => <option key={t} value={t}>{label(t)}{control.states.find((s) => s.target === t)?.engaged ? ' (on)' : ''}</option>)}</select></label>
        : <span>{label(target)}</span>}
      <Badge tone={on ? 'bad' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
      {!on && <ActionButton permission="platform.emergency_controls.manage" danger onPress={() => onEngage(control, target)}>Engage…</ActionButton>}
      {on && !state?.release_action_id && <ActionButton permission="platform.emergency_controls.manage" onPress={() => onRelease(control, target)}>Release…</ActionButton>}
      {on && state?.release_action_id && <small className="admin-soft">Release waiting; cancel it from Staff and security, Waiting actions.</small>}
    </div>
  );
}
