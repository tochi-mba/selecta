import { createContext, FormEvent, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { BrandMark } from '../ui/BrandMark';
import { Icon, IconName } from '../ui/Icon';
import { keptImportWaiting } from './importSession';
import { ACCOUNT_PROBLEMS, AccountProblem, blockedMessage } from './accountStates';
import type { BlockedCode } from './authConfig';
import { ConnectionBanner } from './ConnectionBanner';
import { supportHref } from '../support';
import { SlowToArrive } from '../ui/staleBuild';

// Every screen a person can meet before they are inside SelectaDJ Cloud, other than the landing
// page (Welcome.tsx): checking the sign-in, signing in again, verifying an email, the one-question
// workspace set-up, an account that is blocked or could not be read, and waiting offline. They
// share one frame: the brand, one card with one clear action, who is signed in, and the credit.
// Styles: styles/boot.css (.gate). With the feel system on (ADR-0477) the card arrives on the
// spring and the brand is named "brand-mark", so a page change that can travel carries it into the
// rail's mark (styles/feel-entry.css, styles/feel-scene.css).

/** Who makes SelectaDJ, at the foot of every screen outside the app. */
export function GateFoot() {
  return (
    <footer className="gate-foot">
      <span>SelectaDJ, a REX Technologies product</span>
      <span>© {new Date().getFullYear()} REX Technologies</span>
    </footer>
  );
}

const Problems = createContext<(message: string) => void>(() => undefined);

/** The buttons of a gate screen, the main one first. A press that fails says so under them. */
export function GateActions({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState('');
  return (
    <Problems.Provider value={setProblem}>
      <div className="gate-actions">{children}</div>
      {problem && <p className="gate-problem" role="alert"><Icon name="warning" size="compact" />{problem}</p>}
    </Problems.Provider>
  );
}

/** A button that answers the press at once: its label changes while its work runs, it cannot be
 * pressed twice, and a failure is said under the buttons. `hold` keeps it working a little longer,
 * for work that ends by leaving the page (sign-in, sign-out, a reload). */
export function GateButton({ run, working, hold = false, kind = 'secondary', disabled, type = 'button', children }: {
  run?: () => unknown;
  working: string;
  hold?: boolean;
  kind?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  type?: 'button' | 'submit';
  children: ReactNode;
}) {
  const say = useContext(Problems);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const press = async () => {
    if (busy || !run) return;
    setBusy(true);
    say('');
    try {
      await run();
      if (hold) await new Promise((done) => window.setTimeout(done, 4000));
    } catch (error) {
      say((error as Error)?.message || 'That didn’t work. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <button type={type} className={kind === 'secondary' ? 'gate-button' : `gate-button ${kind}`} disabled={disabled} aria-disabled={busy || undefined} aria-busy={busy || undefined} data-working={busy || undefined} onClick={run ? () => void press() : undefined}>
      {busy ? working : children}
    </button>
  );
}

/** Who is signed in on a screen with no frame, and the way out. */
export function SignedInAs({ email, onSignOut }: { email: string; onSignOut: () => unknown }) {
  return (
    <p className="gate-account">
      <span>Signed in as <strong>{email}</strong></span>
      <GateActionsInline><GateButton kind="quiet" working="Signing out…" hold run={onSignOut}>Sign out</GateButton></GateActionsInline>
    </p>
  );
}
function GateActionsInline({ children }: { children: ReactNode }) {
  return <Problems.Provider value={() => undefined}>{children}</Problems.Provider>;
}

/** The frame of every gate screen: brand, one card, the account line, the credit. */
export function GateScreen({ eyebrow, icon, tone, title, children, actions, account, alert = false, kind }: {
  eyebrow?: string;
  icon?: IconName;
  tone?: 'problem';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  account?: { email: string; onSignOut: () => unknown };
  /** Read out at once: the screen replaced the app because something went wrong. */
  alert?: boolean;
  /** Which screen this is, for styles and checks. */
  kind?: string;
}) {
  return (
    <main className="gate" data-gate={kind}>
      <div className="gate-body">
        <p className="gate-brand" data-vt="brand-mark"><BrandMark className="small" /><span>SelectaDJ</span></p>
        <section className="gate-card" data-tone={tone} role={alert ? 'alert' : undefined} data-arrive="">
          {eyebrow && <p className="gate-eyebrow">{icon && <Icon name={icon} size="compact" />}{eyebrow}</p>}
          <h1>{title}</h1>
          {children}
          {actions && <GateActions>{actions}</GateActions>}
        </section>
        {account && <SignedInAs email={account.email} onSignOut={account.onSignOut} />}
      </div>
      <GateFoot />
    </main>
  );
}

/** A moment of waiting before anything is known: the brand, breathing, what is happening, and a
 * line that keeps moving so the page never looks stuck. */
export function GateLoading({ label }: { label: string }) {
  return (
    <main className="gate gate-loading" aria-busy="true">
      <div className="gate-wait">
        <BrandMark className="gate-pulse" />
        <p role="status">{label}</p>
        <span className="gate-line" aria-hidden="true"><i /></span>
        <SlowToArrive />
      </div>
    </main>
  );
}

/** The sign-in lapsed while the page was open. */
export function SignInAgain({ onSignIn }: { onSignIn: () => unknown }) {
  return (
    <GateScreen kind="sign-in-again" alert eyebrow="Signed out" icon="lock" title="Sign in again to carry on"
      actions={<GateButton kind="primary" working="Opening sign-in…" hold run={onSignIn}>Sign in again</GateButton>}>
      <p>Your sign-in ended. Your songs, your mixes and any import in progress are kept on this device.</p>
    </GateScreen>
  );
}

/** Opened with no connection, before the sign-in could be checked. */
export function OfflineWait() {
  return (
    <GateScreen kind="offline" eyebrow="No connection" icon="warning" title="You’re offline"
      actions={<GateButton kind="primary" working="Checking…" hold run={() => window.location.reload()}>Try again</GateButton>}>
      <p>SelectaDJ needs the connection to check your sign-in. Everything on this device is kept, and this page opens by itself when you’re back online.</p>
      <ConnectionBanner />
    </GateScreen>
  );
}

/** Remembers, across the reload, that the member said they had verified, so a page that comes back
 * unchanged can say the address still isn't verified instead of looking as if nothing happened. */
const VERIFY_ASKED = 'selecta.cloud.verify-asked';

export function VerifyEmail({ email, onSignOut }: { email: string; onSignOut: () => unknown }) {
  const [asked] = useState(() => { try { return sessionStorage.getItem(VERIFY_ASKED) === email; } catch { return false; } });
  const check = () => {
    try { sessionStorage.setItem(VERIFY_ASKED, email); } catch { /* the page still reloads */ }
    window.location.reload();
  };
  return (
    <GateScreen kind="verify-email" eyebrow="One more step" title="Verify your email" account={{ email, onSignOut }}
      actions={<GateButton kind="primary" working="Checking…" hold run={check}>I’ve verified my email</GateButton>}>
      <p>Open the email sent to <strong>{email}</strong> and follow its link, then come back to this page.</p>
      {asked && <p className="gate-note" role="status"><Icon name="warning" size="compact" />That address isn’t verified yet. Open the link in the email, then check again.</p>}
      <p className="gate-hint">Can’t find the email? Look in your spam or junk folder.</p>
    </GateScreen>
  );
}

const BLOCKED_EYEBROW: Record<BlockedCode, { words: string; icon: IconName }> = {
  verified_email_required: { words: 'One more step', icon: 'lock' },
  account_deleting: { words: 'Account closing', icon: 'clock' },
  session_revoked: { words: 'Signed out', icon: 'lock' },
  token_invalid: { words: 'Signed out', icon: 'lock' },
  token_expired: { words: 'Signed out', icon: 'lock' },
};

/** A refusal that replaces the whole app: what happened, and the one way on. */
export function BlockedAccount({ code, distinct, email, onSignOut }: { code: BlockedCode; distinct: boolean; email?: string; onSignOut: () => unknown }) {
  const message = blockedMessage(code, distinct);
  const signIn = code === 'session_revoked' || code === 'token_invalid' || code === 'token_expired';
  const eyebrow = BLOCKED_EYEBROW[code];
  return (
    <GateScreen kind={code} alert eyebrow={eyebrow.words} icon={eyebrow.icon} title={message.title}
      account={!signIn && email ? { email, onSignOut } : undefined}
      actions={code === 'verified_email_required' ? <GateButton kind="primary" working="Checking…" hold run={() => window.location.reload()}>I’ve verified my email</GateButton>
        : signIn ? <GateButton kind="primary" working="Opening sign-in…" hold run={onSignOut}>Sign in again</GateButton>
          : !email ? <GateButton working="Signing out…" hold run={onSignOut}>Sign out</GateButton> : undefined}>
      <p>{message.detail}</p>
      {signIn && keptImportWaiting() && <p>Your music import is kept on this device and carries on after you sign in.</p>}
      {!signIn && code !== 'verified_email_required' && <p><a href={supportHref(`${eyebrow.words}: help with my account`)}>Contact support</a></p>}
    </GateScreen>
  );
}

const PROBLEM_EYEBROW: Record<AccountProblem, string> = { offline: 'No connection', server: 'Service problem', unexpected: 'Account problem' };

/** The account couldn't be read at all, so nothing else can show: why, and the way back. */
export function AccountProblemPage({ kind, onRetry, onSignOut, retrying, email }: { kind: AccountProblem; onRetry: () => void; onSignOut: () => unknown; retrying: boolean; email?: string }) {
  const words = ACCOUNT_PROBLEMS[kind];
  return (
    <main className="gate" data-gate="account-problem" data-account-problem={kind}>
      <div className="gate-body">
        <p className="gate-brand" data-vt="brand-mark"><BrandMark className="small" /><span>SelectaDJ</span></p>
        <section className="gate-card" data-tone="problem" data-arrive="">
          <p className="gate-eyebrow"><Icon name="warning" size="compact" />{PROBLEM_EYEBROW[kind]}</p>
          <h1>{words.title}</h1>
          <p role="alert">{words.detail}</p>
          <GateActions>
            <button type="button" className="gate-button primary" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined} data-working={retrying || undefined}>{retrying ? 'Trying again…' : words.retry}</button>
            {!email && <GateButton working="Signing out…" hold run={onSignOut}>Sign out</GateButton>}
          </GateActions>
          <p><a href={supportHref(`${PROBLEM_EYEBROW[kind]}: my account will not open`)}>Contact support</a></p>
        </section>
        {email && <SignedInAs email={email} onSignOut={onSignOut} />}
      </div>
      <GateFoot />
    </main>
  );
}

/** The one question before a workspace exists: the age check, then Create workspace. */
export function WorkspaceCheck({ email, confirmed, onConfirmed, busy, error, onSubmit, onSignOut }: {
  email: string;
  confirmed: boolean;
  onConfirmed: (next: boolean) => void;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent) => void;
  onSignOut: () => unknown;
}) {
  return (
    <GateScreen kind="workspace-check" eyebrow="One quick check" title="Set up your SelectaDJ workspace" account={{ email, onSignOut }}>
      <p>Your music stays on your own devices. SelectaDJ plans the mixes and plays them here.</p>
      <form className="gate-form" onSubmit={onSubmit}>
        <label className="gate-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} />
          <span>I confirm that I’m at least 13 years old.</span>
        </label>
        {error && <p className="gate-problem" role="alert"><Icon name="warning" size="compact" />{error}</p>}
        <div className="gate-actions">
          <button className="gate-button primary" disabled={!confirmed || busy} aria-busy={busy || undefined} data-working={busy || undefined}>{busy ? 'Creating your workspace…' : 'Create workspace'}</button>
        </div>
      </form>
    </GateScreen>
  );
}
