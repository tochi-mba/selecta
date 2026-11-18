import { clockTime, PLAYBACK_STATUS } from '../../copy';
import type { OutputRoute } from '../onboarding/state';
import { atBoundary, fromEarlierVisit, heardByPerson, heardNothing, invalidate, NEVER_CHECKED, OFFER_WORDS, SoundCheckTruth } from './soundCheckTruth';

/** The single-tablet venue posture (ADR-0460, BF-0460-02), as a pure model.
 *
 * The supported posture: one tablet, in front, awake, on power, after a person heard the check
 * tone. The flow walks those in order (check the tablet, power, keep awake, output, Start, sound
 * check) and then shows a status board. Losing any element moves the status down and names the
 * fix: on battery, wake lock gone or tab hidden is `uncertain`; a call or another app taking the
 * sound is `interrupted`; a route change, a fresh Start or a stale check is `output_unverified`.
 * Only `heard` (a person pressing "I heard it") can make the status verified.
 */

export const VENUE_STEPS = ['probe', 'power', 'wake', 'output', 'start', 'soundcheck', 'ready'] as const;
export type VenueStep = (typeof VENUE_STEPS)[number];

export const VENUE_STEP_TITLES: Record<VenueStep, string> = {
  probe: 'Check this tablet',
  power: 'Plug into power',
  wake: 'Keep the screen on',
  output: 'Check the sound output',
  start: 'Start sound',
  soundcheck: 'Hear the check tone',
  ready: 'Venue status',
};

export type PowerFact = 'charging' | 'on_battery' | 'unknown';
export type WakeFact = 'not_asked' | 'held' | 'released' | 'unsupported' | 'refused';

export type Posture = {
  step: VenueStep;
  probe: { ok: true; notes: string[] } | { ok: false; reason: string } | null;
  /** What the battery API says, where the browser has one, and whether a person said it is plugged in. */
  power: { battery: PowerFact; confirmed: boolean };
  wake: WakeFact;
  wakeReason?: string;
  route: OutputRoute | null;
  started: boolean;
  visible: boolean;
  interrupted: boolean;
  check: SoundCheckTruth;
};

export function freshPosture(lastHeardAt: number | null = null): Posture {
  return {
    step: 'probe',
    probe: null,
    power: { battery: 'unknown', confirmed: false },
    wake: 'not_asked',
    route: null,
    started: false,
    visible: true,
    interrupted: false,
    check: lastHeardAt === null ? NEVER_CHECKED : fromEarlierVisit(lastHeardAt),
  };
}

export type PostureEvent =
  | { type: 'probed'; ok: true; notes: string[] }
  | { type: 'probed'; ok: false; reason: string }
  | { type: 'battery'; fact: PowerFact }
  | { type: 'power_confirmed' }
  | { type: 'wake'; fact: WakeFact; reason?: string }
  | { type: 'wake_done' }
  | { type: 'route_chosen'; route: OutputRoute | null }
  | { type: 'started' }
  | { type: 'heard'; at: number }
  | { type: 'heard_nothing' }
  | { type: 'hidden' }
  | { type: 'visible' }
  | { type: 'route_changed' }
  | { type: 'interrupted' }
  | { type: 'resumed' }
  | { type: 'idle' }
  | { type: 'go'; step: VenueStep };

export function reduce(posture: Posture, event: PostureEvent): Posture {
  switch (event.type) {
    case 'probed':
      return event.ok
        ? { ...posture, probe: { ok: true, notes: event.notes }, step: 'power' }
        : { ...posture, probe: { ok: false, reason: event.reason }, step: 'probe' };
    case 'battery':
      return { ...posture, power: { ...posture.power, battery: event.fact } };
    case 'power_confirmed':
      return { ...posture, power: { ...posture.power, confirmed: true }, step: posture.step === 'power' ? 'wake' : posture.step };
    case 'wake': {
      const lost = event.fact === 'released' && posture.wake === 'held';
      return {
        ...posture,
        wake: event.fact,
        wakeReason: event.reason,
        check: lost ? invalidate(posture.check, 'wake_released') : posture.check,
      };
    }
    case 'wake_done':
      return { ...posture, step: posture.step === 'wake' ? 'output' : posture.step };
    case 'route_chosen':
      return { ...posture, route: event.route, step: posture.step === 'output' ? 'start' : posture.step };
    case 'started':
      // Start is the set-start boundary: the night begins with a fresh check, whatever came before.
      return { ...posture, started: true, interrupted: false, check: atBoundary(posture.check, 'set_start', false), step: 'soundcheck' };
    case 'heard':
      return { ...posture, check: heardByPerson(posture.check, event.at), step: 'ready' };
    case 'heard_nothing':
      return { ...posture, check: heardNothing(posture.check) };
    case 'hidden':
      return { ...posture, visible: false, check: invalidate(posture.check, 'hidden') };
    case 'visible':
      // Coming back proves nothing about the sound: the check stays stale until a person hears it.
      return { ...posture, visible: true };
    case 'route_changed':
      return { ...posture, check: invalidate(posture.check, 'route_changed') };
    case 'interrupted':
      return { ...posture, interrupted: true, check: invalidate(posture.check, 'interrupted') };
    case 'resumed':
      return { ...posture, interrupted: false };
    case 'idle':
      return { ...posture, check: atBoundary(posture.check, 'after_idle', false) };
    case 'go':
      return { ...posture, step: event.step };
  }
}

export type VenueStatusId = 'verified' | 'output_unverified' | 'uncertain' | 'interrupted' | 'unsupported_here';

/** A posture element that is missing, what that means and what to do about it. `downgrades` says
 * whether it lowers the status or is advice only (a browser with no wake lock, for example, is
 * still fine once auto-lock is off, which SelectaDJ cannot see). */
export type PostureProblem = { id: 'power' | 'wake' | 'visible' | 'interrupted' | 'started' | 'check'; what: string; fix: string; downgrades: boolean };

export type VenueStatus = { status: VenueStatusId; label: string; detail: string; problems: PostureProblem[] };

export function postureProblems(posture: Posture): PostureProblem[] {
  const problems: PostureProblem[] = [];
  if (posture.interrupted) {
    problems.push({ id: 'interrupted', what: 'Something else took the sound, like a call or another app.', fix: 'End the call or close the other app, then press Start sound again.', downgrades: true });
  }
  if (!posture.visible) {
    problems.push({ id: 'visible', what: 'SelectaDJ is not in front on this tablet, so the browser may slow it down or stop it.', fix: 'Bring SelectaDJ back to the front and keep it there.', downgrades: true });
  }
  if (posture.power.battery === 'on_battery') {
    problems.push({ id: 'power', what: 'This tablet is running on its battery.', fix: 'Plug it into power. On battery saver the browser may stop the sound.', downgrades: true });
  } else if (!posture.power.confirmed && posture.power.battery !== 'charging') {
    problems.push({ id: 'power', what: 'Nobody has said this tablet is plugged in.', fix: 'Plug it into power, then say so in the power step.', downgrades: false });
  }
  if (posture.wake === 'released') {
    problems.push({ id: 'wake', what: 'The browser stopped keeping the screen on, often because of low battery or battery saver.', fix: 'Press Keep the screen on again, or turn off auto-lock in the device settings.', downgrades: true });
  } else if (posture.wake === 'unsupported' || posture.wake === 'refused' || posture.wake === 'not_asked') {
    problems.push({ id: 'wake', what: 'The browser is not keeping the screen on.', fix: 'Turn off auto-lock in the device settings so the screen never locks.', downgrades: false });
  }
  if (!posture.started) {
    problems.push({ id: 'started', what: 'Sound has not been started on this tablet.', fix: 'Press Start sound.', downgrades: true });
  } else if (!posture.check.fresh) {
    problems.push({ id: 'check', what: 'Nobody has confirmed hearing this tablet since the last change.', fix: posture.check.offer ? OFFER_WORDS[posture.check.offer] : 'Play the check tone and say whether you heard it.', downgrades: true });
  }
  return problems;
}

/** The truthful status for this posture, with every missing element and its fix. */
export function venueStatus(posture: Posture): VenueStatus {
  if (posture.probe?.ok === false) {
    const words = PLAYBACK_STATUS.unsupported_here;
    return { status: 'unsupported_here', label: words.label, detail: words.detail.replace('{reason}', posture.probe.reason), problems: [] };
  }
  const problems = postureProblems(posture);
  const lowering = problems.filter((problem) => problem.downgrades).map((problem) => problem.id);
  let status: VenueStatusId;
  if (lowering.includes('interrupted')) status = 'interrupted';
  else if (lowering.includes('visible') || lowering.includes('wake') || lowering.includes('power')) status = 'uncertain';
  else if (lowering.length || !posture.check.fresh || posture.check.lastHeardAt === null) status = 'output_unverified';
  else status = 'verified';
  if (status === 'verified') {
    return { status, label: 'Sound confirmed', detail: `A person confirmed hearing the check tone at ${clockTime(posture.check.lastHeardAt as number)}. That is when it was heard, not a promise about now.`, problems };
  }
  const words = PLAYBACK_STATUS[status];
  const last = posture.check.lastHeardAt !== null ? ` Last confirmed by a person at ${clockTime(posture.check.lastHeardAt)}.` : '';
  return { status, label: words.label, detail: `${words.detail}${last}`, problems };
}
