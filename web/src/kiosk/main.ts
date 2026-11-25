// The kiosk player at /kiosk (ADR-0445, ADR-0453 S5): its own entry with no React and no manager
// code. It mounts the screens, the hidden staff panel and burn-in protection, plays the zone's
// saved horizon through the real player, heartbeats, reports health and keeps playing offline
// from its saved music (ADR-0446). The wiring lives in controller.ts; this file only builds the
// browser pieces and runs the timers.

import { OfflineClock } from '../business/offline/offlineClock';
import { createZoneCache } from '../business/offline/zoneCache';
import { h, replace } from '../rooms/dom';
import { kioskApi } from './api';
import { zoneAudio } from './audio';
import { startBurnIn } from './burnIn';
import { screenDirection } from './direction';
import type { KioskScreen } from './state';
import { createController, HEALTH_MS, HEARTBEAT_MS, HORIZON_MS, UPDATE_CHECK_MS, VIEW_MS } from './controller';
import { KIOSK_COPY } from './copy';
import { deviceKey, openKeyStore } from './deviceKey';
import { permitStore } from './permit';
import { playLog } from './playLog';
import { renderScreen } from './screens';
import { mountStaffPanel } from './staffPanel';
import { markSession, restartReason } from './startup';
import { registerKioskWorker } from './update';
import { KIOSK_VERSION } from './version';
import { wakeController } from './wake';
import '../styles/tokens.css';
import './kiosk.css';

const TICK_MS = 250;

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  const root = document.getElementById('kiosk') as HTMLElement;
  const restart = restartReason();
  markSession('running');
  document.addEventListener('visibilitychange', () => markSession(document.visibilityState === 'hidden' ? 'closed' : 'running'));
  window.addEventListener('pagehide', () => markSession('closed'));

  const key = await deviceKey(await openKeyStore());
  const api = kioskApi({ sign: (nonce) => key.sign(nonce), version: KIOSK_VERSION });
  const clock = new OfflineClock();
  const cache = createZoneCache({ now: () => clock.now() ?? Date.now() / 1000 });
  const log = playLog();
  const audio = zoneAudio({ cache, now: () => clock.now(), onLog: (entry) => log.add(entry) });
  const worker = await registerKioskWorker().catch(() => null);

  const stage = h('div', { className: 'k-stage', id: 'k-stage' });
  replace(root, stage);
  let shownKind: KioskScreen['kind'] | null = null;
  const burnIn = startBurnIn(() => stage.querySelector('.k-screen'), () => controller.view().burn_in !== false);

  const controller = createController({
    api, key, cache, clock, audio, log, worker,
    permits: permitStore(storage()),
    wake: wakeController(),
    version: KIOSK_VERSION,
    restart,
    wallNow: () => Date.now() / 1000,
    storage: storage(),
    reload: () => location.reload(),
    estimate: async () => (navigator.storage?.estimate ? navigator.storage.estimate() : null),
    battery: async () => {
      const get = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery;
      if (!get) return null;
      const battery = await get.call(navigator);
      return { level: battery.level, charging: battery.charging };
    },
    render: (screen, view, extra) => {
      document.documentElement.dataset.theme = view.theme ?? 'dark';
      // what the player is doing, for staff tools and the browser tests (no words on screen)
      document.documentElement.dataset.audible = extra.audible ? 'yes' : 'no';
      document.documentElement.dataset.savedHours = String(extra.savedHours);
      const node = renderScreen(screen, view, {
        deviceName: view.device_name ?? 'Player',
        pairingCode: extra.pairingCode,
        roomCode: extra.roomCode,
        onTap: () => void controller.tap(),
        onDonePairing: screen.kind === 'unpaired' && controller.state().paired ? () => controller.showCode(false) : undefined,
      });
      if (screen.kind === 'needs_tap' && extra.timeUnknown) node.append(h('p', { className: 'k-quiet' }, KIOSK_COPY.timeUnknown));
      // ADR-0477: a new screen arrives from ahead or behind along the player's day (kiosk.css)
      const way = screenDirection(shownKind, screen.kind);
      shownKind = screen.kind;
      if (way) node.dataset.enter = way;
      replace(stage, node);
      burnIn.apply();
    },
  });

  const panel = mountStaffPanel({
    host: root,
    pinsOn: () => controller.view().pins_on === true,
    checkPin: (pin) => api.checkPin(pin),
    info: () => controller.panelInfo(),
    onReload: () => {
      markSession('staff_reload');
      location.reload();
    },
    onShowCode: () => controller.showCode(true),
  });
  root.prepend(panel.corner);

  await controller.boot();
  const every = (kind: Parameters<typeof controller.every>[0], ms: number) => {
    let running = false;
    window.setInterval(() => {
      if (running) return;
      running = true;
      void controller.every(kind).finally(() => {
        running = false;
      });
    }, ms);
  };
  every('tick', TICK_MS);
  every('heartbeat', HEARTBEAT_MS);
  every('view', VIEW_MS);
  every('horizon', HORIZON_MS);
  every('health', HEALTH_MS);
  every('update', UPDATE_CHECK_MS / 6);
  window.addEventListener('online', () => void controller.every('heartbeat'));
}

void start();
