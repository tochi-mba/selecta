// How a person reaches a human at SelectaDJ: one address, one way of writing to it, used by the
// account menu's Help, the error pages, the billing notices and the deleted-account page.

/** The one support mailbox. OWNER MUST CONFIRM: this mailbox has to exist and be read before
 * launch (docs/engineering/paying-customer-audit.md). Change it here and nowhere else. */
export const SUPPORT_EMAIL = 'support@selectadj.app';

/** The facts about this browser that help support and say nothing about the person: no name,
 * email, account, device, folder or song. Matches what Diagnostics copies for support. */
export function browserFacts(): Record<string, unknown> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const win = typeof window === 'undefined' ? null : window;
  return {
    page: win ? win.location.pathname.replace(/\/[0-9a-f-]{16,}/gi, '/…') : null,
    language: nav?.language ?? null,
    online: nav ? nav.onLine : null,
    web_audio: typeof AudioContext !== 'undefined',
    folder_picker: win ? 'showDirectoryPicker' in win : false,
    screen: win ? `${win.innerWidth}x${win.innerHeight}` : null,
    build: buildMark(),
  };
}

/** The build this tab is running, from its own entry script's hashed name. */
export function buildMark(): string | null {
  if (typeof document === 'undefined') return null;
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script?.getAttribute('src')?.match(/([^/]+)\.js$/)?.[1] ?? null;
}

/** A short reference a person can read out or paste: "R-7KQ2-M9XD". */
export function newReference(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(pick);
  else for (let index = 0; index < pick.length; index += 1) pick[index] = Math.floor(Math.random() * 256);
  const code = [...pick].map((value) => letters[value % letters.length]).join('');
  return `R-${code.slice(0, 4)}-${code.slice(4)}`;
}

/** A mailto link to support with the subject and the browser facts filled in. */
export function supportHref(subject: string, reference?: string): string {
  const lines = [
    'Tell us what happened here:',
    '',
    '',
    '---',
    reference ? `Reference: ${reference}` : null,
    'Details from this browser (no personal data):',
    JSON.stringify(browserFacts(), null, 2),
  ].filter((line) => line !== null);
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
  return `mailto:${SUPPORT_EMAIL}?${query}`;
}

type Reporter = (report: { reference: string; kind: 'page_crash' | 'stale_build'; where: string; build: string }) => Promise<unknown>;
let reporter: Reporter | null = null;

/** Set by the signed-in Cloud app: how a problem reference reaches the server log, so support can
 * find the reference a person quotes. Null when signed out or in the local app. */
export function setProblemReporter(next: Reporter | null): void {
  reporter = next;
}

/** Tell the server a page stopped drawing (or could not load after a deploy), with the reference
 * the person was shown. Never the error text, which can hold personal data. Never throws. */
export function reportProblem(reference: string, kind: 'page_crash' | 'stale_build'): void {
  if (!reporter) return;
  const where = typeof window === 'undefined' ? '' : window.location.pathname.replace(/\/[0-9a-f-]{16,}/gi, '/…').slice(0, 200);
  void reporter({ reference, kind, where, build: buildMark() ?? '' }).catch(() => undefined);
}
