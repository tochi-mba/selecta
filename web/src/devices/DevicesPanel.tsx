import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Api, Device, DEVICE_REGISTERED } from './usePlaybackDevice';
import './devices.css';

// Account > Devices: every browser signed in to this account, newest first, with rename and
// "Sign out this device". The limit is ten; signing in an eleventh signs out the one used least
// recently, and the notice from that registration is shown here too.

function seen(epochSeconds: number) {
  const minutes = Math.round((Date.now() / 1000 - epochSeconds) / 60);
  if (minutes < 2) return 'Active now';
  if (minutes < 60) return `Seen ${minutes} min ago`;
  return `Seen ${new Date(epochSeconds * 1000).toLocaleString()}`;
}

export function DevicesPanel({ api, workspaceId, notice = '' }: { api: Api; workspaceId: string; notice?: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [limit, setLimit] = useState(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
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
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rename = async (event: FormEvent, device: Device) => {
    event.preventDefault();
    try {
      await api(`/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }, workspaceId);
      setEditing(null); setSaid('Renamed.');
      await load();
    } catch (problem) { setError((problem as Error).message); }
  };
  const signOut = async (device: Device) => {
    try {
      await api(`/devices/${encodeURIComponent(device.id)}/sign-out`, { method: 'POST' }, workspaceId);
      setSaid(`${device.name} was signed out.`);
      await load();
    } catch (problem) { setError((problem as Error).message); }
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
              <form onSubmit={(event) => void rename(event, device)}>
                <label htmlFor={`rename-${device.id}`}>Device name</label>
                <input id={`rename-${device.id}`} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus />
                <button type="submit" className="primary">Save</button>
                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span className="devices-name"><strong>{device.name}</strong>{device.this_device && <span className="devices-this"> · This device</span>}</span>
                <span className="devices-seen">{seen(device.last_seen_at)}{device.poor_speaker ? ' · Best as a remote' : ''}</span>
                <span className="devices-actions">
                  <button type="button" onClick={() => { setEditing(device.id); setName(device.name); }} aria-label={`Rename ${device.name}`}>Rename</button>
                  <button type="button" onClick={() => void signOut(device)} aria-label={`Sign out ${device.name}`}>Sign out this device</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
