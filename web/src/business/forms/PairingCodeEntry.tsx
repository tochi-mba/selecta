// PairingCodeEntry (ADR-0453 D6 step 7, ADR-0445): the kiosk shows a code, the manager types it
// here and picks the zone. Pictures of the players that work, a link to the kiosk setup guide,
// and a live confirmation once the player says it is ready. Used on S1 and S3.

import { useState } from 'react';
import { Action, Status } from '../../ui/controls';
import { Select, TextField } from '../../ui/formControls';
import { KIOSK_GUIDE_URL, PAIR_COPY } from '../copy/onboarding';
import type { Device, Zone } from '../types';
import './forms.css';

/** Kiosk codes are 6 letters and numbers; spaces and dashes typed by people are ignored. */
export function cleanCode(text: string) { return text.replace(/[\s-]/g, '').toUpperCase(); }
export const codeOk = (text: string) => /^[A-Z0-9]{6}$/.test(cleanCode(text));

function MiniPc() {
  return <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" focusable="false"><rect x="8" y="10" width="48" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="16" cy="21" r="2" fill="currentColor" /><line x1="40" y1="21" x2="50" y2="21" stroke="currentColor" strokeWidth="2" /></svg>;
}
function TvBox() {
  return <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" focusable="false"><rect x="4" y="4" width="40" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><line x1="18" y1="36" x2="30" y2="36" stroke="currentColor" strokeWidth="2" /><rect x="48" y="24" width="12" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}
function Tablet() {
  return <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" focusable="false"><rect x="14" y="2" width="36" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="32" cy="33" r="1.6" fill="currentColor" /></svg>;
}

export function PairingCodeEntry({ zones, onPair, isReady }: {
  zones: Zone[];
  onPair: (code: string, zoneId: string, name: string) => Promise<Device>;
  isReady?: (deviceId: string) => boolean;
}) {
  const [code, setCode] = useState('');
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
  const zoneName = zones.find((zone) => zone.id === zoneId)?.name ?? '';
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [paired, setPaired] = useState<Device | null>(null);
  const shownName = name.trim() || `${zoneName} player`;

  const pair = async () => {
    if (!codeOk(code)) { setError(PAIR_COPY.badCode); return; }
    setError('');
    try {
      setPaired(await onPair(cleanCode(code), zoneId, shownName));
      setCode('');
    } catch {
      setError(PAIR_COPY.failed);
    }
  };

  const ready = paired ? (isReady ? isReady(paired.id) : paired.online) : false;

  return <div className="bzf-pair">
    <ul className="bzf-devices" aria-label={PAIR_COPY.devices}>
      <li><MiniPc /><span>{PAIR_COPY.miniPc}</span></li>
      <li><TvBox /><span>{PAIR_COPY.tvBox}</span></li>
      <li><Tablet /><span>{PAIR_COPY.tablet}</span></li>
    </ul>
    <p>{PAIR_COPY.how}</p>
    <p><a href={KIOSK_GUIDE_URL} target="_blank" rel="noreferrer">{PAIR_COPY.guide}</a> <span className="biz-quiet">{PAIR_COPY.guideHelp}</span></p>
    {!zones.length ? <p className="biz-quiet">{PAIR_COPY.noZones}</p> : <div className="bzf-form">
      <TextField label={PAIR_COPY.code} help={PAIR_COPY.codeHelp} value={code} onChange={(value) => setCode(value.toUpperCase())} error={error} />
      <Select label={PAIR_COPY.zone} value={zoneId} onChange={setZoneId} options={zones.map((zone) => ({ value: zone.id, label: zone.name }))} />
      <TextField label={PAIR_COPY.name} value={name} onChange={setName} placeholder={`${zoneName} player`} />
      <div className="biz-row"><Action className="primary" run={pair} working={PAIR_COPY.pairing}>{PAIR_COPY.pair}</Action></div>
    </div>}
    <div role="status" aria-live="polite" className="bzf-pair-status">
      {paired && (ready
        ? <p><Status kind="ready">Ready</Status> {PAIR_COPY.ready(paired.name)}</p>
        : <p><Status kind="working">Waiting</Status> {PAIR_COPY.waiting(paired.name)}</p>)}
    </div>
  </div>;
}
