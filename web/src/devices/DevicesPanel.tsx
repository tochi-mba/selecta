import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Notice, SettingsCard } from '../cloud/AccountLayout';
import { Action } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ELLIPSIS, relativeTime, userLocale } from '../ui/format';
import { Icon, IconName } from '../ui/Icon';
import { showToast } from '../ui/toasts';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { Api, Device, DEVICE_REGISTERED } from './usePlaybackDevice';
import './devices.css';

// Account > Devices: every browser signed in to this account, this one first and then the most
// recently used, each with what it is, when it signed in and when it was last active, so two
// browsers with the same name can still be told apart. Each can be renamed and signed out. The
// limit is ten; signing in an eleventh signs out the one used least recently, and the notice from
// that registration is shown here too. The list is read again every 15 s while the tab is on screen
// (useVisiblePoll); signing a device out asks first. At the limit the card says what that means
// and offers the way to free the places: sign out every other device in one press, after asking.

export function seen(epochSeconds: number, nowSeconds = Date.now() / 1000) {
  const age = nowSeconds - epochSeconds;
  if (age < 120) return 'Active now';
  return `Last active ${relativeTime(age)}`;
}

/** The server also says when a device first signed in; an older server leaves it out. */
type Listed = Device & { created_at?: number };

const KINDS: Record<string, string> = { laptop: 'Computer', desktop: 'Computer', phone: 'Phone', tablet: 'Tablet', tv: 'TV' };
const KIND_ICONS: Record<string, IconName> = { phone: 'phone', tablet: 'tablet' };

/** This device first, then the most recently active. */
export function inOrder<T extends Pick<Device, 'this_device' | 'last_seen_at'>>(devices: T[]): T[] {
  return [...devices].sort((a, b) => Number(b.this_device) - Number(a.this_device) || b.last_seen_at - a.last_seen_at);
}

function dayWords(epochSeconds: number) {
  // with the time: several browsers that signed in on one day are still told apart
  return new Date(epochSeconds * 1000).toLocaleString(userLocale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function exactWords(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleString(userLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function DevicesPanel({ api, workspaceId, notice = '', titled = true }: {
  api: Api;
  workspaceId: string;
  notice?: string;
  /** false on a page whose own title is already "Devices", so the card says what the list is instead */
  titled?: boolean;
}) {
  const [devices, setDevices] = useState<Listed[] | null>(null);
  const [limit, setLimit] = useState(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [renameError, setRenameError] = useState('');
  const [forgetting, setForgetting] = useState<Device | null>(null);
  const [clearing, setClearing] = useState(false);
  const [thisDevice, setThisDevice] = useState<string | null>(() => { try { return localStorage.getItem(`selecta.device.${workspaceId}`); } catch { return null; } });
  // after a rename ends (saved or cancelled), focus goes back to that row's Rename button
  const renamed = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const registered = (event: Event) => setThisDevice((event as CustomEvent<string>).detail);
    window.addEventListener(DEVICE_REGISTERED, registered);
    return () => window.removeEventListener(DEVICE_REGISTERED, registered);
  }, []);

  const load = useCallback(async () => {
    try {
      const query = thisDevice ? `?device_id=${encodeURIComponent(thisDevice)}` : '';
      const listed = await api<{ devices: Listed[]; limit: number }>(`/devices${query}`, {}, workspaceId);
      setDevices(listed.devices); setLimit(listed.limit); setError('');
    } catch (problem) { setError((problem as Error).message); }
  }, [api, thisDevice, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  useVisiblePoll(load, 15_000);

  useEffect(() => {
    if (editing !== null || !renamed.current) return;
    const id = renamed.current;
    renamed.current = null;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('[data-rename]') ?? [];
    for (const button of buttons) if (button.dataset.rename === id) button.focus();
  }, [editing]);

  const stopEditing = (device: Device) => { renamed.current = device.id; setEditing(null); setRenameError(''); };
  const rename = async (device: Device) => {
    const next = name.trim();
    if (!next) { setRenameError('Give this device a name.'); return; }
    if (next === device.name) { stopEditing(device); return; }
    try {
      await api(`/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) }, workspaceId);
      // the row shows its new name at once; the list is read again behind it
      setDevices((was) => was && was.map((row) => (row.id === device.id ? { ...row, name: next } : row)));
      stopEditing(device);
      showToast(`Renamed to ${next}.`);
      await load();
    } catch (problem) { setRenameError((problem as Error).message); }
  };
  // Throws on refusal, so the confirmation stays open and says what went wrong.
  const signOut = async (device: Device) => {
    await api(`/devices/${encodeURIComponent(device.id)}/sign-out`, { method: 'POST' }, workspaceId);
    showToast(`${device.name} was signed out.`);
    setError('');
    await load();
  };

  const ordered = devices ? inOrder(devices) : [];
  const names = new Map<string, number>();
  for (const device of ordered) names.set(device.name, (names.get(device.name) ?? 0) + 1);
  const sameNames = [...names.values()].some((count) => count > 1);
  const signedIn = ordered.filter((device) => device.signed_in !== false).length;
  // "the others" only means something once this browser knows which row is its own
  const here = ordered.find((device) => device.this_device);
  const others = here ? ordered.filter((device) => !device.this_device && device.signed_in !== false) : [];
  const full = devices !== null && signedIn >= limit;
  const otherWords = others.length === 1 ? '1 other device' : `${others.length} other devices`;

  // One at a time, so a refusal part-way says how many are still signed in.
  const signOutOthers = async () => {
    let failed = 0;
    for (const device of others) {
      try { await api(`/devices/${encodeURIComponent(device.id)}/sign-out`, { method: 'POST' }, workspaceId); }
      catch { failed += 1; }
    }
    await load();
    const done = others.length - failed;
    if (failed) throw new Error(done ? `${done} signed out, but ${failed} could not be. Try again.` : 'Those devices could not be signed out. Try again.');
    showToast(done === 1 ? '1 other device was signed out.' : `${done} other devices were signed out.`);
  };

  const bulk = others.length > 0 ? (
    <Action type="button" className={full ? 'primary' : undefined} run={() => setClearing(true)} busy={clearing}>
      <Icon name="signout" size="toolbar" />Sign out all other devices
    </Action>
  ) : undefined;

  return (
    <SettingsCard
      id="devices"
      className="devices-panel"
      title={titled ? 'Devices' : 'Signed-in devices'}
      badge={devices && devices.length > 0 ? <Badge tone={full ? 'warn' : undefined}><span className="devices-count">{`${signedIn} of ${limit} signed in`}</span></Badge> : undefined}
      about={`Sign in on up to ${limit} devices. One plays the music at a time; the others work as remotes.`}
      actions={full ? undefined : bulk}
      busy={!devices && !error}
    >
      {full && (
        <Notice tone="warn" action={bulk}>
          <strong>{`All ${limit} places are in use`}</strong>
          <span>The next device to sign in will sign out the one used least recently. To choose which stay, sign out the ones you no longer use.</span>
        </Notice>
      )}
      {notice && <Notice tone="info">{notice}</Notice>}
      {error && devices && <Notice tone="danger" role="alert" action={<Action type="button" className="small" run={load} working={`Trying${ELLIPSIS}`}>Try again</Action>}><strong>This list may be out of date</strong><span>{error}</span></Notice>}
      {!devices && error && (
        <div className="empty-state boxed devices-empty" data-tone="error" role="alert">
          <span className="empty-state-icon"><Icon name="warning" /></span>
          <h3>Your devices could not be loaded</h3>
          <p>{error}</p>
          <div className="empty-state-actions"><Action type="button" run={load} working={`Trying${ELLIPSIS}`}>Try again</Action></div>
        </div>
      )}
      {!devices && !error && (
        <div className="devices-loading" role="status" aria-label="Loading your devices">
          {[0, 1, 2].map((row) => <div className="devices-row" key={row} aria-hidden="true"><i className="devices-icon skeleton-box" /><div className="devices-main"><i className="skeleton-line devices-skeleton-name" /><i className="skeleton-line devices-skeleton-meta" /></div></div>)}
        </div>
      )}
      {devices && devices.length === 0 && (
        <div className="empty-state boxed devices-empty">
          <span className="empty-state-icon"><Icon name="system" /></span>
          <h3>No devices yet</h3>
          <p>This browser appears here a moment after it opens SelectaDJ.</p>
        </div>
      )}
      {sameNames && <p className="acct-help">Some devices share a name. Rename them, for example “Kitchen laptop”, to tell them apart.</p>}
      {ordered.length > 0 && (
        <ul className="devices-list" ref={list}>
          {ordered.map((device) => {
            const out = device.signed_in === false;
            return (
              <li key={device.id} className="devices-row" data-testid="device-row" data-this={device.this_device || undefined} data-out={out || undefined}>
                <span className="devices-icon" aria-hidden="true"><Icon name={KIND_ICONS[device.kind] ?? 'system'} /></span>
                {editing === device.id ? (
                  <form
                    onSubmit={(event: FormEvent) => { event.preventDefault(); void rename(device); }}
                    onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); stopEditing(device); } }}
                  >
                    <label htmlFor={`rename-${device.id}`} className="visually-hidden">Device name</label>
                    <input
                      id={`rename-${device.id}`}
                      value={name}
                      maxLength={60}
                      placeholder="For example, Kitchen laptop"
                      onChange={(event) => { setName(event.target.value); setRenameError(''); }}
                      onFocus={(event) => event.target.select()}
                      aria-invalid={renameError ? true : undefined}
                      aria-describedby={renameError ? `rename-${device.id}-error` : undefined}
                      autoFocus
                    />
                    <span className="devices-actions">
                      <Action type="button" className="primary small" run={() => rename(device)} working={`Saving${ELLIPSIS}`}>Save</Action>
                      <button type="button" className="quiet small" onClick={() => stopEditing(device)}>Cancel</button>
                    </span>
                    {renameError && <p className="devices-error" id={`rename-${device.id}-error`} role="alert">{renameError}</p>}
                  </form>
                ) : (
                  <>
                    <div className="devices-main">
                      <span className="devices-name">
                        <strong dir="auto">{device.name}</strong>
                        {device.this_device && <span className="devices-this"><Icon name="check" size="compact" />This device</span>}
                      </span>
                      <span className="devices-seen">
                        {KINDS[device.kind] && <span>{KINDS[device.kind]}</span>}
                        <span title={exactWords(device.last_seen_at)} data-live={!out && seen(device.last_seen_at) === 'Active now' ? '' : undefined}>{out ? 'Signed out' : seen(device.last_seen_at)}</span>
                        {device.created_at ? <span>Signed in {dayWords(device.created_at)}</span> : null}
                        {device.poor_speaker ? <span>Best as a remote</span> : null}
                      </span>
                    </div>
                    <span className="devices-actions">
                      <button type="button" className="quiet small" data-rename={device.id} onClick={() => { setEditing(device.id); setName(device.name); setRenameError(''); }} aria-label={`Rename ${device.name}`}><Icon name="edit" size="toolbar" />Rename</button>
                      {!out && <Action type="button" className="small" run={() => setForgetting(device)} busy={forgetting?.id === device.id} aria-label={`Sign out this device: ${device.name}`}>Sign out</Action>}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {forgetting && (
        <ConfirmDialog
          title={`Sign out ${forgetting.name}?`}
          body={forgetting.this_device
            ? 'This is the device you are using now. You will need to sign in again to carry on here.'
            : 'It stops playing and leaves your account. It can sign in again any time.'}
          confirmLabel="Sign out this device"
          working={`Signing out${ELLIPSIS}`}
          onConfirm={() => signOut(forgetting)}
          onClose={() => setForgetting(null)}
        />
      )}
      {clearing && (
        <ConfirmDialog
          title={`Sign out ${otherWords}?`}
          body={`Every device except this one leaves your account, and any music playing on them stops. This device stays signed in. That frees ${others.length} of your ${limit} places, and any of them can sign in again.`}
          confirmLabel={`Sign out ${otherWords}`}
          cancelLabel="Keep them signed in"
          working={`Signing out${ELLIPSIS}`}
          onConfirm={signOutOthers}
          onClose={() => setClearing(false)}
        />
      )}
    </SettingsCard>
  );
}
