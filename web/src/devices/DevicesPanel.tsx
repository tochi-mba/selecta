import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Action } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ELLIPSIS, relativeTime } from '../ui/format';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { Api, Device, DEVICE_REGISTERED } from './usePlaybackDevice';
import './devices.css';

// Account > Devices: every browser signed in to this account, newest first, with rename and
// "Sign out this device". The limit is ten; signing in an eleventh signs out the one used least
// recently, and the notice from that registration is shown here too. The list is read again every
// 15 s while the tab is on screen (useVisiblePoll); signing a device out asks first.

export function seen(epochSeconds: number, nowSeconds = Date.now() / 1000) {
  const age = nowSeconds - epochSeconds;
  if (age < 120) return 'Active now';
  return `Seen ${relativeTime(age)}`;
}

export function DevicesPanel({ api, workspaceId, notice = '' }: { api: Api; workspaceId: string; notice?: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [limit, setLimit] = useState(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [forgetting, setForgetting] = useState<Device | null>(null);
  const [thisDevice, setThisDevice] = useState<string | null>(() => { try { return localStorage.getItem(`selecta.device.${workspaceId}`); } catch { return null; } });
  useEffect(() => {
    const registered = (event: Event) => setThisDevice((event as CustomEvent<string>).detail);
    window.addEventListener(DEVICE_REGISTERED, registered);
    return () => window.removeEventListener(DEVICE_REGISTERED, registered);
  }, []);

  const load = useCallback(async () => {
    try {
      const query = thisDevice ? `?device_id=${encodeURIComponent(thisDevice)}` : '';
      const listed = await api<{ devices: Device[]; limit: number }>(`/devices${query}`, {}, workspaceId);
      setDevices(listed.devices); setLimit(listed.limit); setError('');
    } catch (problem) { setError((problem as Error).message); }
  }, [api, thisDevice, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  useVisiblePoll(load, 15_000);

  const rename = async (device: Device) => {
    try {
      await api(`/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }, workspaceId);
      setEditing(null); setSaid('Renamed.');
      await load();
    } catch (problem) { setError((problem as Error).message); }
  };
  // Throws on refusal, so the confirmation stays open and says what went wrong.
  const signOut = async (device: Device) => {
    await api(`/devices/${encodeURIComponent(device.id)}/sign-out`, { method: 'POST' }, workspaceId);
    setSaid(`${device.name} was signed out.`);
    setError('');
    await load();
  };

  return (
    <section className="devices-panel" aria-labelledby="devices-title">
      <h2 id="devices-title">Devices</h2>
      <p className="devices-help">{`You can be signed in on ${limit} devices. One plays at a time; the others are remotes.`}</p>
      {notice && <p className="devices-notice" role="status">{notice}</p>}
      {said && <p className="devices-notice" role="status">{said}</p>}
      {error && <p className="devices-error" role="alert">{error}</p>}
      <ul className="devices-list">
        {devices.map((device) => (
          <li key={device.id} data-testid="device-row">
            {editing === device.id ? (
              <form onSubmit={(event: FormEvent) => { event.preventDefault(); void rename(device); }}>
                <label htmlFor={`rename-${device.id}`}>Device name</label>
                <input id={`rename-${device.id}`} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus />
                <Action type="button" className="primary" run={() => rename(device)} working={`Saving${ELLIPSIS}`}>Save</Action>
                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span className="devices-name"><strong>{device.name}</strong>{device.this_device && <span className="devices-this"> · This device</span>}</span>
                <span className="devices-seen">{seen(device.last_seen_at)}{device.poor_speaker ? ' · Best as a remote' : ''}</span>
                <span className="devices-actions">
                  <button type="button" onClick={() => { setEditing(device.id); setName(device.name); }} aria-label={`Rename ${device.name}`}>Rename</button>
                  <Action type="button" run={() => setForgetting(device)} busy={forgetting?.id === device.id} aria-label={`Sign out this device: ${device.name}`}>Sign out this device</Action>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {forgetting && (
        <ConfirmDialog
          title={`Sign out ${forgetting.name}?`}
          body="That device is signed out of your account. It can sign in again any time."
          confirmLabel="Sign out this device"
          destructive
          working={`Signing out${ELLIPSIS}`}
          onConfirm={() => signOut(forgetting)}
          onClose={() => setForgetting(null)}
        />
      )}
    </section>
  );
}
