import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Action, Problem, Skeleton } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ELLIPSIS, relativeTime, userLocale } from '../ui/format';
import { Icon } from '../ui/Icon';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { Api, Device, DEVICE_REGISTERED } from './usePlaybackDevice';
import './devices.css';

// Account > Devices: every browser signed in to this account, this one first and then the most
// recently used, each with what it is, when it signed in and when it was last active, so two
// browsers with the same name can still be told apart. Each can be renamed and signed out. The
// limit is ten; signing in an eleventh signs out the one used least recently, and the notice from
// that registration is shown here too. The list is read again every 15 s while the tab is on screen
// (useVisiblePoll); signing a device out asks first.

export function seen(epochSeconds: number, nowSeconds = Date.now() / 1000) {
  const age = nowSeconds - epochSeconds;
  if (age < 120) return 'Active now';
  return `Seen ${relativeTime(age)}`;
}

/** The server also says when a device first signed in; an older server leaves it out. */
type Listed = Device & { created_at?: number };

const KINDS: Record<string, string> = { laptop: 'Computer', desktop: 'Computer', phone: 'Phone', tablet: 'Tablet', tv: 'TV' };

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
  /** false on a page whose own title is already "Devices", so the heading is not shown twice */
  titled?: boolean;
}) {
  const [devices, setDevices] = useState<Listed[] | null>(null);
  const [limit, setLimit] = useState(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [renameError, setRenameError] = useState('');
  const [said, setSaid] = useState('');
  const [forgetting, setForgetting] = useState<Device | null>(null);
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
      stopEditing(device); setSaid(`Renamed to ${next}.`);
      await load();
    } catch (problem) { setRenameError((problem as Error).message); }
  };
  // Throws on refusal, so the confirmation stays open and says what went wrong.
  const signOut = async (device: Device) => {
    await api(`/devices/${encodeURIComponent(device.id)}/sign-out`, { method: 'POST' }, workspaceId);
    setSaid(`${device.name} was signed out.`);
    setError('');
    await load();
  };

  const ordered = devices ? inOrder(devices) : [];
  const names = new Map<string, number>();
  for (const device of ordered) names.set(device.name, (names.get(device.name) ?? 0) + 1);
  const sameNames = [...names.values()].some((count) => count > 1);
  const signedIn = ordered.filter((device) => device.signed_in !== false).length;

  return (
    <section className="cloud-card devices-panel" aria-labelledby="devices-title">
      <div className="devices-head">
        <h2 id="devices-title" className={titled ? undefined : 'visually-hidden'}>Devices</h2>
        {devices && devices.length > 0 && <span className="devices-count">{`${signedIn} of ${limit} signed in`}</span>}
      </div>
      <p className="devices-help">{`You can be signed in on ${limit} devices. One plays at a time; the others are remotes.`}</p>
      {notice && <p className="devices-notice" role="status">{notice}</p>}
      {said && <p className="devices-notice" role="status">{said}</p>}
      {error && devices && <p className="devices-error" role="alert">{error}</p>}
      {!devices && (error
        ? <Problem retry={load}>SelectaDJ couldn’t load your devices. {error}</Problem>
        : <Skeleton variant="rows" lines={3} label="Loading your devices" />)}
      {devices && devices.length === 0 && <p className="devices-help">No devices are signed in yet. This browser appears here a moment after it opens SelectaDJ.</p>}
      {sameNames && <p className="devices-help">Some devices share a name. Rename them, for example “Kitchen laptop”, to tell them apart at a glance.</p>}
      <ul className="devices-list" ref={list}>
        {ordered.map((device) => (
          <li key={device.id} data-testid="device-row" data-this={device.this_device || undefined}>
            {editing === device.id ? (
              <form
                onSubmit={(event: FormEvent) => { event.preventDefault(); void rename(device); }}
                onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); stopEditing(device); } }}
              >
                <label htmlFor={`rename-${device.id}`}>Device name</label>
                <input
                  id={`rename-${device.id}`}
                  value={name}
                  maxLength={60}
                  onChange={(event) => { setName(event.target.value); setRenameError(''); }}
                  onFocus={(event) => event.target.select()}
                  aria-invalid={renameError ? true : undefined}
                  aria-describedby={renameError ? `rename-${device.id}-error` : undefined}
                  autoFocus
                />
                <span className="devices-actions">
                  <Action type="button" className="primary" run={() => rename(device)} working={`Saving${ELLIPSIS}`}>Save</Action>
                  <button type="button" onClick={() => stopEditing(device)}>Cancel</button>
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
                    <span title={exactWords(device.last_seen_at)}>{device.signed_in === false ? 'Signed out' : seen(device.last_seen_at)}</span>
                    {device.created_at ? <span>Signed in {dayWords(device.created_at)}</span> : null}
                    {device.poor_speaker ? <span>Best as a remote</span> : null}
                  </span>
                </div>
                <span className="devices-actions">
                  <button type="button" data-rename={device.id} onClick={() => { setEditing(device.id); setName(device.name); setRenameError(''); setSaid(''); }} aria-label={`Rename ${device.name}`}>Rename</button>
                  {device.signed_in !== false && <Action type="button" run={() => setForgetting(device)} busy={forgetting?.id === device.id} aria-label={`Sign out this device: ${device.name}`}>Sign out</Action>}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {forgetting && (
        <ConfirmDialog
          title={`Sign out ${forgetting.name}?`}
          body={forgetting.this_device
            ? 'That device is signed out of your account. It can sign in again any time. This is the device you are using now.'
            : 'That device is signed out of your account. It can sign in again any time.'}
          confirmLabel="Sign out this device"
          working={`Signing out${ELLIPSIS}`}
          onConfirm={() => signOut(forgetting)}
          onClose={() => setForgetting(null)}
        />
      )}
    </section>
  );
}
