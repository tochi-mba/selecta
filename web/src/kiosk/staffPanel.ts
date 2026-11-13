// The hidden staff panel (ADR-0453 D11, KioskStaffPanel). A three-second press on the top-left
// corner (pointer, or holding Enter or Space on the focusable corner), then the staff PIN when
// the venue uses PINs, opens a read-only panel: device name, zone, network, hours of music saved
// ahead, last sync, app version, "Reload player" and "Show pairing code". Nothing else.
// It is not modal: there is no keyboard trap, Escape closes it, and focus goes back to the corner.

import { h, replace } from '../rooms/dom';
import { KIOSK_COPY as C } from './copy';

export const HOLD_MS = 3000;

export type PanelInfo = {
  deviceName: string;
  zone: string;
  network: 'online' | 'offline' | 'unknown';
  savedHours: number;
  lastSync: number | null;
  version: string;
};

export type StaffPanelOptions = {
  host: HTMLElement;
  pinsOn: () => boolean;
  checkPin: (pin: string) => Promise<boolean>;
  info: () => PanelInfo;
  onReload: () => void;
  onShowCode: () => void;
  holdMs?: number;
  timeWords?: (at: number) => string;
};

export type StaffPanel = { corner: HTMLElement; open(): void; close(): void; isOpen(): boolean; destroy(): void };

const defaultTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function mountStaffPanel(options: StaffPanelOptions): StaffPanel {
  const hold = options.holdMs ?? HOLD_MS;
  const timeWords = options.timeWords ?? defaultTime;
  const doc = options.host.ownerDocument;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let layer: HTMLElement | null = null;

  const corner = h('button', { type: 'button', className: 'k-corner', id: 'k-corner', 'aria-label': C.staffCorner });
  const cancelHold = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const startHold = () => {
    cancelHold();
    timer = setTimeout(() => {
      timer = null;
      ask();
    }, hold);
  };
  corner.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startHold();
  });
  for (const name of ['pointerup', 'pointerleave', 'pointercancel']) corner.addEventListener(name, cancelHold);
  corner.addEventListener('contextmenu', (event) => event.preventDefault());
  corner.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault();
      startHold();
    }
  });
  corner.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') cancelHold();
  });
  // a short click never opens anything
  corner.addEventListener('click', (event) => event.preventDefault());

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && layer) {
      event.preventDefault();
      close();
    }
  };
  doc.addEventListener('keydown', onKey);

  function show(content: HTMLElement): void {
    if (!layer) {
      layer = h('div', { className: 'k-panel-layer', id: 'k-panel' });
      options.host.append(layer);
    }
    replace(layer, content);
    (layer.querySelector('input, h2') as HTMLElement | null)?.focus();
  }

  function ask(): void {
    if (!options.pinsOn()) {
      open();
      return;
    }
    const input = h('input', { id: 'k-pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 12 }) as HTMLInputElement;
    const wrong = h('p', { className: 'k-quiet', id: 'k-pin-wrong', role: 'status' });
    const form = h('form', { className: 'k-panel', 'aria-labelledby': 'k-pin-title', role: 'dialog', 'aria-modal': 'false' },
      h('h2', { id: 'k-pin-title', tabindex: '-1' }, C.pinTitle),
      h('label', { for: 'k-pin' }, C.pinLabel),
      input,
      wrong,
      h('div', { className: 'k-panel-actions' },
        h('button', { type: 'submit', className: 'k-plain' }, C.pinOpen),
        h('button', { type: 'button', className: 'k-plain', onclick: () => close() }, C.cancel)));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const pin = input.value;
      input.value = '';
      void options.checkPin(pin).then((ok) => {
        if (ok) open();
        else {
          wrong.textContent = C.pinWrong;
          input.focus();
        }
      });
    });
    show(form);
  }

  function open(): void {
    const info = options.info();
    const row = (label: string, value: string) => h('div', { className: 'k-panel-row' }, h('dt', {}, label), h('dd', {}, value));
    show(h('section', { className: 'k-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'k-panel-title' },
      h('h2', { id: 'k-panel-title', tabindex: '-1' }, C.panelTitle),
      h('dl', {},
        row(C.deviceName, info.deviceName),
        row(C.zone, info.zone),
        row(C.network, C.networkWords[info.network]),
        row(C.savedAhead, C.hours(info.savedHours)),
        row(C.lastSync, info.lastSync ? timeWords(info.lastSync) : C.never),
        row(C.version, info.version)),
      h('div', { className: 'k-panel-actions' },
        h('button', { type: 'button', className: 'k-plain', id: 'k-reload', onclick: () => options.onReload() }, C.reload),
        h('button', { type: 'button', className: 'k-plain', id: 'k-show-code', onclick: () => { close(); options.onShowCode(); } }, C.showCode),
        h('button', { type: 'button', className: 'k-plain', onclick: () => close() }, C.close))));
  }

  function close(): void {
    if (!layer) return;
    layer.remove();
    layer = null;
    if (corner.isConnected) corner.focus();
  }

  return {
    corner,
    open,
    close,
    isOpen: () => layer !== null && layer.querySelector('#k-panel-title') !== null,
    destroy: () => {
      cancelHold();
      doc.removeEventListener('keydown', onKey);
      close();
    },
  };
}
