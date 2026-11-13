import type { Page } from './api';
import { ACCOUNT_PROBLEMS, AccountProblem, SUSPENDED_STATE } from './accountStates';

// The Cloud site's honest states (ADR-0420, `cloud.account_states`): an address that isn't a
// page, an account that couldn't be read, and a suspended account. Each says what happened and
// offers the way back, rather than an empty page with a raw error over it.

/** An address no page answers to. The menu stays, so every page is one step away. */
export function NotFound({ path, go }: { path: string; go: (page: Page) => void }) {
  return (
    <section className="cloud-card cloud-not-found" aria-labelledby="cloud-not-found-title">
      <p className="cloud-eyebrow">NOTHING AT THIS ADDRESS</p>
      <h2 id="cloud-not-found-title">There’s no SelectaDJ Cloud page at {path}</h2>
      <p>The link may be mistyped or out of date. Your music and settings are unaffected.</p>
      <div className="cloud-actions"><button className="primary" onClick={() => go('home')}>Go to Overview</button><button onClick={() => go('library')}>Open your library</button></div>
    </section>
  );
}

/** The account couldn't be read at all, so nothing else can show: why, and the way back. */
export function AccountProblemPage({ kind, onRetry, onSignOut, retrying }: { kind: AccountProblem; onRetry: () => void; onSignOut: () => void; retrying: boolean }) {
  const words = ACCOUNT_PROBLEMS[kind];
  return (
    <main className="cloud-runtime-message" data-account-problem={kind}>
      <span className="cloud-mark">S</span>
      <h1>{words.title}</h1>
      <p role="alert">{words.detail}</p>
      <div className="cloud-actions">
        <button className="primary" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>{retrying ? 'Trying again…' : words.retry}</button>
        <button onClick={onSignOut}>Sign out</button>
      </div>
    </main>
  );
}

/** A later read of the account failed: what's on screen is the last good copy. */
export function AccountProblemNote({ kind, onRetry }: { kind: AccountProblem; onRetry: () => void }) {
  const words = ACCOUNT_PROBLEMS[kind];
  return (
    <div className="cloud-feedback cloud-account-problem" role="status" data-account-problem={kind}>
      <strong>{words.title}.</strong> What you see was loaded earlier and may be out of date. <button onClick={onRetry}>{words.retry}</button>
    </div>
  );
}

/** A suspended account: what still works, and the two ways out. */
export function SuspendedPanel({ go }: { go: (page: Page) => void }) {
  return (
    <section className="cloud-feedback cloud-suspended" role="status" aria-labelledby="cloud-suspended-title">
      <h2 id="cloud-suspended-title">{SUSPENDED_STATE.title}</h2>
      <p>{SUSPENDED_STATE.detail}</p>
      <div className="cloud-actions"><button onClick={() => go('settings')}>Download my data</button><button onClick={() => go('library')}>View library</button></div>
    </section>
  );
}
