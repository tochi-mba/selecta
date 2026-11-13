// The PIN keypad for shared tablets (ADR-0453 D10, BZ-0453-14): 64 px keys, digits never shown,
// typing on a keyboard works too. Inside the existing Dialog, so focus is trapped and returned.

import { KeyboardEvent, useState } from 'react';
import { Dialog } from '../../ui/controls';
import { STAFF_COPY } from '../copy/staff';
import './staff.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MAX = 8;

export function PinKeypad({ onSubmit, onClose }: { onSubmit: (pin: string) => Promise<boolean>; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = (digit: string) => { setWrong(false); setPin((value) => (value.length >= MAX ? value : value + digit)); };
  const back = () => setPin((value) => value.slice(0, -1));
  const go = async () => {
    if (!pin || busy) return;
    setBusy(true);
    try {
      const ok = await onSubmit(pin);
      if (!ok) { setWrong(true); setPin(''); }
    } catch {
      setWrong(true); setPin('');
    } finally {
      setBusy(false);
    }
  };
  const keys = (event: KeyboardEvent) => {
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); add(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); back(); }
    else if (event.key === 'Enter') { event.preventDefault(); void go(); }
  };
  return (
    <Dialog title={STAFF_COPY.pinTitle} onClose={onClose}>
      <div className="biz-pin" onKeyDown={keys}>
        <p className="biz-quiet">{STAFF_COPY.pinHelp}</p>
        <p className="biz-pin-dots" aria-live="polite" aria-label={STAFF_COPY.pinShown(pin.length)}>{'•'.repeat(pin.length)}</p>
        {wrong && <p role="alert">{STAFF_COPY.pinWrong}</p>}
        <div className="biz-pin-pad" role="group" aria-label={STAFF_COPY.pinTitle}>
          {KEYS.map((digit) => <button key={digit} type="button" className="biz-pin-key" onClick={() => add(digit)}>{digit}</button>)}
          <button type="button" className="biz-pin-key" aria-label={STAFF_COPY.pinBack} onClick={back}>{'←'}</button>
          <button type="button" className="biz-pin-key" onClick={() => add('0')}>0</button>
          <button type="button" className="biz-pin-key" aria-busy={busy || undefined} onClick={() => void go()}>{STAFF_COPY.pinGo}</button>
        </div>
      </div>
    </Dialog>
  );
}
