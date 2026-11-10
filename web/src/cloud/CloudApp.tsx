import { useAuth } from '@workos-inc/authkit-react';
import { sha256 } from '@noble/hashes/sha2.js';
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BLOCKED_MESSAGES, BlockedCode, blockedCode, refusalMessage, SUSPENDED_NOTICE } from './authConfig';
import './cloud.css';

type Account = {
  user: { id: string; email: string; email_verified: boolean; suspended?: boolean };
  workspace: { id: string; name: string; role: string };
  entitlement: { plan: string; plan_version: number; storage_limit_bytes: number; storage_used_bytes: number; storage_state: string };
  features: Record<string, boolean>;
  feature_locks: Record<string, string>;
};
type UploadEntry = { index: number; name: string; refused: string | null; duplicate_of: string | null; same_as: string | null; session: { id: string; name: string; size: number; part_size: number; part_count: number; status: string } | null };
type UploadResult = { uploads: UploadEntry[] };
type UploadStatus = { upload: { id: string; name: string; size: number; status: string; error: string | null }; uploaded_parts: { number: number; etag: string; size: number }[] };
type Page = 'home' | 'library' | 'uploads' | 'billing' | 'settings';
type Asset = { id: string; name: string; size: number; sha256: string | null; format: string | null; duration_seconds: number | null; sample_rate: number | null; channels: number | null; created_at: number };
const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');
const consentVersion = import.meta.env.VITE_CHECKOUT_CONSENT_VERSION ?? '';

class CloudError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

function idempotencyKey() {
  return crypto.randomUUID();
}

async function fileSha256(file: File) {
  const hash = sha256.create();
  const chunkSize = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    hash.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function messageOf(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: unknown }).message);
    if (detail && typeof detail === 'object' && 'code' in detail) return String((detail as { code: unknown }).code).replaceAll('_', ' ');
  }
  return fallback;
}

function bytes(value: number) {
  const unit = value >= 1_000_000_000 ? 'GB' : 'MB';
  return `${(value / (unit === 'GB' ? 1_000_000_000 : 1_000_000)).toFixed(1)} ${unit}`;
}

function pageFor(pathname: string): Page {
  return pathname.includes('/account/billing') ? 'billing' : pathname.includes('/library') ? 'library' : 'home';
}

export function CloudApp() {
  const { isLoading, user, getAccessToken, signIn, signUp, signOut } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [blocked, setBlocked] = useState<BlockedCode | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [page, setPage] = useState<Page>(() => pageFor(window.location.pathname));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> => {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (workspaceId) headers.set('X-Workspace-ID', workspaceId);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${apiOrigin}/api${path}`, { ...init, headers });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload === 'object' && 'detail' in payload ? (payload as { detail: unknown }).detail : undefined;
      const code = detail && typeof detail === 'object' && 'code' in detail ? String((detail as { code: unknown }).code) : undefined;
      // An account-level refusal replaces the whole app with a plain explanation.
      const accountState = blockedCode(code);
      if (accountState) setBlocked(accountState);
      throw new CloudError(refusalMessage(code) ?? messageOf(payload, `Request failed (${response.status}).`), response.status, code);
    }
    return payload as T;
  }, [getAccessToken]);

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    setError('');
    try {
      const next = await api<Account>('/account');
      setAccount(next);
      setNeedsOnboarding(false);
    } catch (problem) {
      if (problem instanceof CloudError && problem.status === 409 && problem.code === 'not_onboarded') {
        setNeedsOnboarding(true);
        setAccount(null);
      } else {
        setError((problem as Error).message);
      }
    }
  }, [api, user]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  // After sign-in, AuthKit's redirect callback moves to the page the person started from.
  useEffect(() => {
    const follow = () => setPage(pageFor(window.location.pathname));
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  const startSignIn = () => void signIn({ state: { returnTo: `${window.location.pathname}${window.location.search}` } });

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get('checkout');
    if (checkout === 'cancelled') setNotice('Checkout was cancelled. Your plan has not changed.');
    if (checkout !== 'success' || !user) return;
    setPage('billing');
    setNotice('Confirming your payment with Stripe…');
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void api<Account>('/account').then((next) => {
        setAccount(next);
        if (next.entitlement.plan !== 'free') {
          setNotice(`Your ${next.entitlement.plan} plan is active.`);
          window.clearInterval(timer);
        } else if (attempts >= 20) {
          setNotice('Payment is still being confirmed. This page will show your plan as soon as Stripe updates it.');
          window.clearInterval(timer);
        }
      }).catch(() => {
        if (attempts >= 20) window.clearInterval(timer);
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [api, user]);

  const completeOnboarding = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/onboarding/complete', { method: 'POST', body: JSON.stringify({ age_confirmed: ageConfirmed }) });
      await refreshAccount();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const openCheckout = async (plan: 'standard' | 'premium', interval: 'month' | 'year') => {
    if (!account) return;
    const accepted = document.querySelector<HTMLInputElement>('#checkout-consent')?.checked ?? false;
    const immediate = document.querySelector<HTMLInputElement>('#checkout-immediate')?.checked ?? false;
    const cancellation = document.querySelector<HTMLInputElement>('#checkout-cancellation')?.checked ?? false;
    setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>('/billing/checkout', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ plan, interval, consent_version: consentVersion, accepted_terms: accepted, requested_immediate_access: immediate, acknowledged_cancellation_right: cancellation }),
      }, account.workspace.id);
      window.location.assign(result.url);
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const openPortal = async () => {
    if (!account) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>('/billing/portal', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ return_url: `${window.location.origin}/account/billing` }),
      }, account.workspace.id);
      window.location.assign(result.url);
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const signOutEverywhere = async () => {
    if (!account) return;
    setBusy(true); setError('');
    try {
      await api('/account/sign-out-everywhere', { method: 'POST' }, account.workspace.id);
      signOut({ returnTo: window.location.origin });
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const deleteAccount = async () => {
    const confirmed = window.confirm('Delete your Selecta Cloud account? Your account will be hidden and you will be signed out immediately. Final erasure is scheduled after the 30-day recovery window.');
    if (!confirmed) return;
    setBusy(true); setError('');
    try {
      await api('/account', { method: 'DELETE' }, account?.workspace.id);
      signOut({ returnTo: window.location.origin });
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const downloadAccountExport = async () => {
    if (!account) return;
    setBusy(true); setError(''); setNotice('Preparing your account export…');
    try {
      const token = await getAccessToken();
      const response = await fetch(`${apiOrigin}/api/account/export`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': account.workspace.id },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new CloudError(messageOf(payload, `Export failed (${response.status}).`), response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'selecta-account-export.zip'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Your export is ready. It contains your originals and profile settings; mix data is not stored in Cloud yet.');
    } catch (problem) { setError((problem as Error).message); setNotice(''); }
    finally { setBusy(false); }
  };

  const choosePage = (next: Page) => { setPage(next); setNotice(''); setError(''); };

  if (isLoading) return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><p>Checking your sign-in…</p></main>;
  if (!user) return <main className="cloud-welcome"><span className="cloud-mark">S</span><p className="cloud-eyebrow">SELECTA CLOUD</p><h1>Your music, ready to move.</h1><p>Build your library, shape the set and keep the transitions ready on every device.</p><div className="cloud-actions"><button className="primary" onClick={() => void signUp()}>Create your account</button><button onClick={startSignIn}>Sign in</button></div><small>Your music stays private to your workspace.</small></main>;
  if (blocked) return <BlockedAccount code={blocked} onSignOut={() => signOut({ returnTo: window.location.origin })} />;
  if (!user.emailVerified) return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><h1>Verify your email</h1><p>Open the verification email for {user.email}, then refresh this page.</p><button onClick={() => window.location.reload()}>I’ve verified my email</button><button onClick={() => signOut({ returnTo: window.location.origin })}>Sign out</button></main>;
  if (needsOnboarding) return <main className="cloud-onboarding"><span className="cloud-mark">S</span><p className="cloud-eyebrow">ONE QUICK CHECK</p><h1>Set up your Selecta workspace</h1><p>Your personal space starts with 10 GB of private music storage.</p><form onSubmit={(event) => void completeOnboarding(event)}><label className="cloud-check"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /> I confirm that I’m at least 13 years old.</label><button className="primary" disabled={!ageConfirmed || busy}>Create workspace</button></form><Feedback error={error} notice="" /></main>;

  const used = account?.entitlement.storage_used_bytes ?? 0;
  const limit = account?.entitlement.storage_limit_bytes ?? 0;
  const pct = limit ? Math.min(100, used / limit * 100) : 0;
  return (
    <div className="cloud-shell">
      <aside className="cloud-rail">
        <button className="cloud-brand" aria-label="Selecta Cloud home" onClick={() => choosePage('home')}><span className="cloud-mark">S</span><span>Selecta<span className="cloud-brand-sub">CLOUD</span></span></button>
        <nav aria-label="Cloud workspace">
          <button aria-current={page === 'home' ? 'page' : undefined} onClick={() => choosePage('home')}>Overview</button>
          <button aria-current={page === 'library' ? 'page' : undefined} onClick={() => choosePage('library')}>Library</button>
          <button aria-current={page === 'uploads' ? 'page' : undefined} onClick={() => choosePage('uploads')}>Add music</button>
          <button aria-current={page === 'billing' ? 'page' : undefined} onClick={() => choosePage('billing')}>Plan & billing</button>
          <button aria-current={page === 'settings' ? 'page' : undefined} onClick={() => choosePage('settings')}>Settings</button>
        </nav>
        <div className="cloud-rail-bottom"><span>{user.email}</span><button onClick={() => void signOutEverywhere()} disabled={busy}>Sign out everywhere</button><button className="cloud-delete-account" onClick={() => void deleteAccount()} disabled={busy}>Delete account</button></div>
      </aside>
      <main className="cloud-main">
        <header className="cloud-top"><div><p className="cloud-eyebrow">{account?.workspace.name ?? 'YOUR WORKSPACE'}</p><h1>{page === 'home' ? 'Your music workspace' : page === 'library' ? 'Your library' : page === 'uploads' ? 'Add music' : page === 'billing' ? 'Plan & billing' : 'Account settings'}</h1></div><span className="cloud-plan-chip">{account?.entitlement.plan ?? 'Free'} plan</span></header>
        {account?.user.suspended && <div className="cloud-feedback" role="status">{SUSPENDED_NOTICE}</div>}
        <Feedback error={error} notice={notice} />
        {page === 'home' && account && <Overview account={account} used={used} limit={limit} percent={pct} go={choosePage} />}
        {page === 'library' && account && <LibraryPanel api={api} workspaceId={account.workspace.id} setError={setError} refreshAccount={refreshAccount} go={choosePage} />}
        {page === 'uploads' && account && <UploadsPanel api={api} workspaceId={account.workspace.id} setError={setError} setNotice={setNotice} />}
        {page === 'billing' && account && <Billing account={account} used={used} limit={limit} percent={pct} busy={busy} onCheckout={(plan, interval) => void openCheckout(plan, interval)} onPortal={() => void openPortal()} />}
        {page === 'settings' && account && <section className="cloud-card"><p className="cloud-eyebrow">YOUR DATA</p><h2>Download a copy</h2><p>Your export contains your original audio files, account profile settings and a file manifest. Mixes are not stored in Selecta Cloud yet.</p><button className="primary" disabled={busy} onClick={() => void downloadAccountExport()}>{busy ? 'Preparing export…' : 'Download my data'}</button></section>}
        <footer className="cloud-footer">Selecta Cloud · Your originals remain private to your workspace.</footer>
      </main>
    </div>
  );
}

function BlockedAccount({ code, onSignOut }: { code: BlockedCode; onSignOut: () => void }) {
  const message = BLOCKED_MESSAGES[code];
  return <main className="cloud-runtime-message" role="alert"><span className="cloud-mark">S</span><h1>{message.title}</h1><p>{message.detail}</p>
    {code === 'verified_email_required' && <button onClick={() => window.location.reload()}>I’ve verified my email</button>}
    <button onClick={onSignOut}>{code === 'session_revoked' || code === 'token_invalid' || code === 'token_expired' ? 'Sign in again' : 'Sign out'}</button>
  </main>;
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  if (!error && !notice) return null;
  return <div className={error ? 'cloud-feedback error' : 'cloud-feedback'} role={error ? 'alert' : 'status'}>{error || notice}</div>;
}

function Overview({ account, used, limit, percent, go }: { account: Account; used: number; limit: number; percent: number; go: (page: Page) => void }) {
  return <>
    <section className="cloud-hero"><div><p className="cloud-eyebrow">MADE FOR YOUR NEXT SET</p><h2>Your library starts here.</h2><p>Add your tracks and Selecta will prepare them for your next mix.</p><button className="primary" onClick={() => go('uploads')}>Add music</button></div><div className="cloud-hero-art" aria-hidden="true"><span>♪</span><i /><b /><em /></div></section>
    <div className="cloud-cards"><StorageCard used={used} limit={limit} percent={percent} /><section className="cloud-card"><p className="cloud-eyebrow">CURRENT PLAN</p><h2>{account.entitlement.plan[0]?.toUpperCase()}{account.entitlement.plan.slice(1)}</h2><p>Storage and processing limits are managed with your plan.</p><button onClick={() => go('billing')}>Manage plan</button></section><section className="cloud-card"><p className="cloud-eyebrow">YOUR MUSIC</p><h2>Library and uploads</h2><p>Browse private files or add tracks to your workspace.</p><button onClick={() => go('library')}>Open library</button><button onClick={() => go('uploads')}>Upload tracks</button></section></div>
    <section className="cloud-card cloud-locked"><div><p className="cloud-eyebrow">PREMIUM FEATURE</p><h2>Host a request room</h2><p>Share a QR code so guests can add requests to your set.</p></div><button onClick={() => go('billing')}>{account.feature_locks.rooms === 'premium' ? 'Explore Premium' : 'View plans'}</button></section>
  </>;
}

function StorageCard({ used, limit, percent }: { used: number; limit: number; percent: number }) {
  return <section className="cloud-card"><div className="cloud-card-heading"><div><p className="cloud-eyebrow">STORAGE</p><h2>{bytes(used)} <small>of {bytes(limit)}</small></h2></div><span>{Math.round(percent)}%</span></div><div className="cloud-meter" role="progressbar" aria-label="Storage used" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div><p>Unused space is ready when you are.</p></section>;
}

function LibraryPanel({ api, workspaceId, setError, refreshAccount, go }: { api: <T,>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>; workspaceId: string; setError: (value: string) => void; refreshAccount: () => Promise<void>; go: (page: Page) => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const [playback, setPlayback] = useState<{ id: string; name: string; url: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackGeneration = useRef(0);
  useEffect(() => () => { playbackGeneration.current += 1; }, [workspaceId]);
  const refreshedUrl = useRef(false);
  const restorePlayback = useRef<{ time: number; wasPlaying: boolean } | null>(null);
  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const page = await api<{ assets: Asset[]; next_cursor: string | null }>(`/assets?${query}`, {}, workspaceId);
      setAssets((old) => append ? [...old, ...page.assets] : page.assets);
      setNextCursor(page.next_cursor);
    } catch (problem) { setError((problem as Error).message); }
    finally { setLoading(false); }
  }, [api, setError, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  const remove = async (asset: Asset) => {
    if (!window.confirm(`Remove ${asset.name} from your library?`)) return;
    setBusyId(asset.id); setError('');
    try {
      await api(`/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' }, workspaceId);
      setAssets((old) => old.filter((entry) => entry.id !== asset.id));
      await refreshAccount();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusyId(''); }
  };
  const listen = async (asset: Asset) => {
    const generation = ++playbackGeneration.current;
    restorePlayback.current = null;
    setPlayback(null);
    setBusyId(asset.id); setError('');
    try {
      const path = `/assets/${encodeURIComponent(asset.id)}/playback-proxy`;
      type ProxyStatus = { status: string; url?: string };
      let result = await api<ProxyStatus>(path, { method: 'POST' }, workspaceId);
      const deadline = Date.now() + 300_000;
      while (result.status !== 'ready') {
        if (generation !== playbackGeneration.current) return;
        if (['failed', 'cancelled', 'quarantined', 'not_requested'].includes(result.status)) {
          throw new Error('Audio preparation could not finish. Try Listen again.');
        }
        if (Date.now() >= deadline) throw new Error('Audio is still being prepared. Try Listen again shortly.');
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (generation !== playbackGeneration.current) return;
        result = await api<ProxyStatus>(path, {}, workspaceId);
      }
      if (!result.url) throw new Error('The prepared audio link is unavailable.');
      if (generation !== playbackGeneration.current) return;
      refreshedUrl.current = false;
      restorePlayback.current = null;
      setPlayback({ id: asset.id, name: asset.name, url: result.url });
    } catch (problem) {
      if (generation === playbackGeneration.current) setError((problem as Error).message);
    } finally {
      if (generation === playbackGeneration.current) setBusyId('');
    }
  };
  const refreshPlaybackUrl = async () => {
    const generation = playbackGeneration.current;
    const current = playback;
    const audio = audioRef.current;
    if (!current) return;
    if (refreshedUrl.current) {
      setError('This playback link could not be refreshed. Try Listen again.');
      return;
    }
    refreshedUrl.current = true;
    restorePlayback.current = {
      time: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      wasPlaying: Boolean(audio && !audio.paused),
    };
    setError('');
    try {
      const result = await api<{ status: string; url?: string }>(`/assets/${encodeURIComponent(current.id)}/playback-proxy`, {}, workspaceId);
      if (result.status !== 'ready' || !result.url) throw new Error('The prepared audio is no longer available. Try Listen again.');
      if (generation !== playbackGeneration.current) return;
      setPlayback({ ...current, url: result.url });
    } catch (problem) {
      if (generation !== playbackGeneration.current) return;
      restorePlayback.current = null;
      setError((problem as Error).message || 'This playback link could not be refreshed.');
    }
  };
  const restoreAfterUrlRefresh = () => {
    const audio = audioRef.current;
    const restore = restorePlayback.current;
    if (!audio || !restore) return;
    restorePlayback.current = null;
    if (restore.time > 0 && Number.isFinite(audio.duration) && restore.time < audio.duration) {
      audio.currentTime = restore.time;
    }
    if (restore.wasPlaying) void audio.play().catch(() => {});
    else audio.pause();
  };
  return <section className="cloud-library"><div className="cloud-library-heading"><div><p className="cloud-eyebrow">PRIVATE TO THIS WORKSPACE</p><p>Listen to an original track here. Cloud mixes and prepared playback files are coming next.</p></div><div><button onClick={() => void load()} disabled={loading}>Refresh</button><button className="primary" onClick={() => go('uploads')}>Upload tracks</button></div></div>
    {playback && <section className="cloud-card cloud-library-player"><div><p className="cloud-eyebrow">NOW PLAYING</p><strong>{playback.name}</strong></div><audio ref={audioRef} controls autoPlay={restorePlayback.current?.wasPlaying ?? true} src={playback.url} onLoadedMetadata={restoreAfterUrlRefresh} onError={() => void refreshPlaybackUrl()} /></section>}
    {loading && assets.length === 0 ? <p>Loading your library…</p> : assets.length === 0 ? <div className="cloud-card"><h2>Your library is empty</h2><p>Start by uploading tracks from your device.</p><button className="primary" onClick={() => go('uploads')}>Add tracks</button></div> : <>
      <div className="cloud-library-list">{assets.map((asset) => <article className="cloud-library-row" key={asset.id}><span className="cloud-library-icon" aria-hidden="true">♪</span><div className="cloud-library-meta"><strong>{asset.name}</strong><span>{asset.format?.toUpperCase() ?? 'Audio'} · {bytes(asset.size)}{asset.duration_seconds ? ` · ${Math.round(asset.duration_seconds / 60)} min` : ''}</span></div><button onClick={() => void listen(asset)} disabled={busyId === asset.id}>{busyId === asset.id ? 'Opening…' : playback?.id === asset.id ? 'Play again' : 'Listen'}</button><button onClick={() => void remove(asset)} disabled={busyId === asset.id}>Remove</button></article>)}</div>
      {nextCursor && <button onClick={() => void load(nextCursor, true)} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
    </>}
  </section>;
}

function Billing({ account, used, limit, percent, busy, onCheckout, onPortal }: { account: Account; used: number; limit: number; percent: number; busy: boolean; onCheckout: (plan: 'standard' | 'premium', interval: 'month' | 'year') => void; onPortal: () => void }) {
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [terms, setTerms] = useState(false);
  const [immediate, setImmediate] = useState(false);
  const [cancellation, setCancellation] = useState(false);
  const paid = account.entitlement.plan !== 'free';
  return <div className="cloud-billing"><StorageCard used={used} limit={limit} percent={percent} />
    {paid ? <section className="cloud-card"><p className="cloud-eyebrow">SUBSCRIPTION</p><h2>{account.entitlement.plan[0]?.toUpperCase()}{account.entitlement.plan.slice(1)}</h2><p>Manage payment details, invoices or cancellation in the secure Stripe portal.</p><button className="primary" disabled={busy} onClick={onPortal}>Open billing portal</button></section> : <>
      <section className="cloud-legal"><h2>Before subscribing</h2><p>By asking us to start the digital service now, you acknowledge that access begins during the 14-day cancellation period and that you may lose the right to cancel once the service has been fully performed. Your exact consent wording is versioned by Selecta.</p>
        <label><input id="checkout-consent" type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /> I agree to the subscription terms.</label>
        <label><input id="checkout-immediate" type="checkbox" checked={immediate} onChange={(event) => setImmediate(event.target.checked)} /> I request immediate access to the digital service.</label>
        <label><input id="checkout-cancellation" type="checkbox" checked={cancellation} onChange={(event) => setCancellation(event.target.checked)} /> I acknowledge the information about my 14-day cancellation right.</label>
        {!consentVersion && <p className="cloud-inline-error">Checkout is not configured for this site yet.</p>}
      </section>
      <div className="cloud-interval" role="group" aria-label="Billing interval"><button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>Monthly</button><button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>Annual</button></div>
      <div className="cloud-plan-grid"><PlanCard name="Standard" storage="50 GB" price={interval === 'month' ? '£6.99 / month' : '£59 / year'} description="More room for your working library." onSelect={() => onCheckout('standard', interval)} disabled={busy || !consentVersion || !terms || !immediate || !cancellation} /><PlanCard name="Premium" storage="100 GB" price={interval === 'month' ? '£12.99 / month' : '£109 / year'} description="Priority processing and guest request rooms." featured onSelect={() => onCheckout('premium', interval)} disabled={busy || !consentVersion || !terms || !immediate || !cancellation} /></div>
    </>}
  </div>;
}

function PlanCard({ name, storage, price, description, featured, onSelect, disabled }: { name: string; storage: string; price: string; description: string; featured?: boolean; onSelect: () => void; disabled: boolean }) {
  return <section className={`cloud-plan-card ${featured ? 'featured' : ''}`}><p className="cloud-eyebrow">{featured ? 'MOST ROOM TO PLAY' : 'FOR YOUR GROWING LIBRARY'}</p><h2>{name}</h2><strong>{storage}</strong><p className="cloud-price">{price}</p><p>{description}</p><button className={featured ? 'primary' : ''} disabled={disabled} onClick={onSelect}>Choose {name}</button></section>;
}

function UploadsPanel({ api, workspaceId, setError, setNotice }: { api: <T,>(path: string, init?: RequestInit, workspaceId?: string) => Promise<T>; workspaceId: string; setError: (value: string) => void; setNotice: (value: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [items, setItems] = useState<{ name: string; status: string; detail?: string }[]>([]);
  const selected = useCallback((event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? [])), []);

  const begin = async () => {
    if (!files.length) return;
    setUploading(true); setError(''); setNotice(''); setItems([]);
    try {
      setProgress('Checking file contents');
      const specs: { name: string; size: number; content_type?: string; sha256: string }[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setProgress(`Checking ${index + 1} of ${files.length}`);
        specs.push({ name: file.name, size: file.size, content_type: file.type || undefined, sha256: await fileSha256(file) });
      }
      const planned = await api<UploadResult>('/uploads/plan', { method: 'POST', body: JSON.stringify({ files: specs }) }, workspaceId);
      const next: { name: string; status: string; detail?: string }[] = [];
      for (const entry of planned.uploads) {
        if (entry.refused) { next.push({ name: entry.name, status: 'Skipped', detail: entry.refused }); continue; }
        let session = entry.session;
        const file = files[entry.index];
        if (!session || !file) continue;
        if (entry.duplicate_of && !window.confirm(`${entry.name} already exists in your library. Keep another copy anyway?`)) {
          await api(`/uploads/${session.id}`, { method: 'DELETE' }, workspaceId);
          next.push({ name: entry.name, status: 'Skipped', detail: 'A matching copy is already in your library.' });
          setItems([...next]);
          continue;
        }
        if (entry.same_as) {
          await api(`/uploads/${session.id}`, { method: 'DELETE' }, workspaceId);
          const resumed = await api<UploadStatus>(`/uploads/${entry.same_as}`, {}, workspaceId);
          if (resumed.upload.status === 'accepted') {
            next.push({ name: entry.name, status: 'Already in your library', detail: 'This file matches another upload in this batch.' });
            setItems([...next]);
            continue;
          }
          session = { ...session, id: entry.same_as, status: resumed.upload.status };
        }
        try {
          setProgress(`Uploading ${file.name}`);
          const current = await api<UploadStatus>(`/uploads/${session.id}`, {}, workspaceId);
          const completedParts = new Set(current.uploaded_parts.map((part) => part.number));
          for (let number = 1; number <= session.part_count; number += 1) {
            if (completedParts.has(number)) continue;
            const urls = await api<{ part_urls: Record<string, string> }>(`/uploads/${session.id}/parts`, { method: 'POST', body: JSON.stringify({ part_numbers: [number] }) }, workspaceId);
            const start = (number - 1) * session.part_size;
            const response = await fetch(urls.part_urls[String(number)], { method: 'PUT', body: file.slice(start, Math.min(start + session.part_size, file.size)) });
            if (!response.ok) throw new Error(`Part ${number} failed to upload.`);
          }
          const result = await api<{ status: string; error?: string }>(`/uploads/${session.id}/complete`, { method: 'POST' }, workspaceId);
          next.push({ name: entry.name, status: result.status === 'accepted' ? 'Upload accepted' : result.status, detail: result.error ?? undefined });
        } catch (problem) { next.push({ name: entry.name, status: 'Needs attention', detail: (problem as Error).message }); }
        setItems([...next]);
      }
      setItems(next);
      setNotice('Upload session finished. You can return to this page to check its status.');
    } catch (problem) { setError((problem as Error).message); }
    finally { setUploading(false); setProgress(''); }
  };

  return <section className="cloud-upload-panel"><div className="cloud-upload-intro"><p className="cloud-eyebrow">PRIVATE LIBRARY</p><h2>Add your tracks</h2><p>Files transfer directly to private object storage. Selecta checks the actual audio format, file size and duration before accepting an upload.</p></div><label className="cloud-drop"><input type="file" multiple accept="audio/*,.aiff,.aif,.flac,.mp3,.m4a,.wav,.ogg,.opus" onChange={selected} /><span className="cloud-drop-icon">＋</span><strong>{files.length ? `${files.length} files selected` : 'Choose music files'}</strong><small>MP3, FLAC, WAV, AIFF, M4A, AAC and Ogg audio</small></label><div className="cloud-upload-actions"><button className="primary" disabled={!files.length || uploading} onClick={() => void begin()}>{uploading ? 'Uploading…' : 'Start upload'}</button>{progress && <span role="status">{progress}</span>}</div>{items.length > 0 && <ul className="cloud-upload-list">{items.map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><b>{item.status}</b>{item.detail && <small>{item.detail}</small>}</li>)}</ul>}
  </section>;
}
