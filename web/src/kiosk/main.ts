/** Supervised local browser venue player. Not a hosted audio or background agent.
 *
 * This entry is intentionally independent of a native Python engine. Advanced
 * Cloud schedules, staff sessions and Rooms require a separately authenticated
 * browser-session integration; do not pretend those services are running here.
 */
import { browserKioskAudio } from './audio';
import type { LocalRecording } from '../venue-player/browserAudio';
import './browserKiosk.css';

const root = document.getElementById('kiosk');

function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement, tag: K, label: string, className = '',
): HTMLElementTagNameMap[K] {
  const child = document.createElement(tag);
  child.textContent = label;
  if (className) child.className = className;
  parent.append(child);
  return child;
}

function button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
  const control = element(parent, 'button', label);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function startBrowserKiosk(mount: HTMLElement): void {
  mount.replaceChildren();
  mount.className = 'selecta-browser-kiosk';
  const player = browserKioskAudio();
  let files: File[] = [];
  let recordings: LocalRecording[] = [];
  let index = 0;
  let generation = 0;
  let busy = false;
  let closed = false;

  const heading = element(mount, 'header', '', 'kiosk-heading');
  element(heading, 'p', 'SELECTA · BROWSER VENUE PLAYER', 'kiosk-eyebrow');
  element(heading, 'h1', 'Play music from this device');
  element(heading, 'p',
    'Works on a supported iPad, Android tablet or laptop without installing Python. Keep the browser foreground, awake and powered for supervised venue use.');
  element(mount, 'p',
    'This page provides local, supervised playback only. Cloud schedules, guest Rooms and remote staff controls are not connected here. Background and reboot recovery are not guaranteed.',
    'kiosk-warning');

  const setup = element(mount, 'section', '', 'kiosk-card');
  element(setup, 'h2', '1 · Select local music');
  const picker = element(setup, 'input', '');
  picker.type = 'file'; picker.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus';
  picker.multiple = true; picker.setAttribute('aria-label', 'Choose authorised local music');
  const rightsLabel = element(setup, 'label', '', 'kiosk-rights');
  const rights = document.createElement('input');
  rights.type = 'checkbox';
  rightsLabel.append(rights, document.createTextNode(
    ' I confirm this venue is authorised to play these recordings and that they are available on this device.',
  ));
  const selected = element(setup, 'p', 'No local files selected.', 'kiosk-muted');
  const statusPanel = element(mount, 'section', '', 'kiosk-card');
  element(statusPanel, 'h2', '2 · Start and check speaker');
  const status = element(statusPanel, 'p', 'Browser audio not started.', 'kiosk-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const sound = element(statusPanel, 'p', 'Physical speaker: not checked.', 'kiosk-muted');
  const errors = element(statusPanel, 'p', '', 'kiosk-error');
  errors.setAttribute('role', 'alert');
  const controls = element(statusPanel, 'div', '', 'kiosk-actions');
  const startButton = button(controls, 'Tap to start music', () => { void start(); });
  const nextButton = button(controls, 'Next', () => { void next(); });
  const pauseButton = button(controls, 'Pause / Resume', () => { void pauseOrResume(); });
  const stopButton = button(controls, 'Stop', () => { void stop(); });
  const testButton = button(controls, 'Play speaker test tone', () => { void soundCheck(); });
  const heardButton = button(controls, 'Yes, I heard the test', () => {
    if (!player.confirmHeard()) {
      errors.textContent = 'Run the test tone while the browser is active, then confirm it within two minutes.';
    } else errors.textContent = '';
    refresh();
  });
  const info = element(mount, 'section', '', 'kiosk-card');
  element(info, 'h2', 'Playback and recovery');
  element(info, 'p',
    'Selected music stays in this browser. Bluetooth/USB speaker changes, screen locking, battery saving or switching apps may interrupt audio. An operator must restart safely.');
  const link = element(info, 'a', 'Open Selecta Cloud for account and venue management');
  link.href = '/';

  function report(error: unknown): void {
    errors.textContent = error instanceof Error ? error.message : 'Local browser playback failed.';
    refresh();
  }
  function refresh(): void {
    if (closed) return;
    const snapshot = player.snapshot();
    const name = recordings[index]?.title ?? 'No selected recording';
    status.textContent = snapshot.phase + ' · ' + name + ' · ' +
      (snapshot.remainingSeconds == null ? 'no active audio clock' :
        Math.ceil(snapshot.remainingSeconds) + 's remaining') +
      (snapshot.foreground ? '' : ' · NOT FOREGROUND');
    sound.textContent = snapshot.output === 'operator_checked'
      ? 'Physical speaker: operator-confirmed after a recent test tone.'
      : 'Physical speaker: unverified. Audio context running does not prove audible output.';
    startButton.disabled = busy || !files.length || !rights.checked;
    nextButton.disabled = busy || index + 1 >= recordings.length;
    pauseButton.disabled = busy || !recordings.length;
    stopButton.disabled = busy || !recordings.length;
    testButton.disabled = busy;
    heardButton.disabled = busy;
  }
  function localRecords(chosen: readonly File[]): LocalRecording[] {
    return chosen.map((file, position) => ({
      id: 'kiosk-' + position + '-' + file.size + '-' + file.lastModified,
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '', revision: String(file.size) + ':' + String(file.lastModified),
      file, permitted: true, // gated by explicit on-site rights acknowledgement
    }));
  }
  async function prepareNext(): Promise<void> {
    const nextRecord = recordings[index + 1];
    if (nextRecord && !closed) {
      await player.prepare(nextRecord.id).catch(() => {
        errors.textContent = 'Next local file could not be prepared; choose another file or reconnect it.';
      });
    }
  }
  async function start(): Promise<void> {
    if (busy || !files.length || !rights.checked || closed) return;
    // AudioContext.resume must run inside the original click/tap stack on iOS.
    const activation = player.unlock();
    busy = true; errors.textContent = ''; refresh();
    try {
      if (!await activation) throw new Error('Audio remains blocked. Tap Start again and check browser sound permissions.');
      if (!recordings.length) {
        recordings = localRecords(files);
        player.importLocal(recordings);
        index = 0;
      }
      if (player.snapshot().phase === 'paused') await player.resume();
      else await player.start(recordings[index].id, ++generation);
      void prepareNext();
    } catch (error) { report(error); }
    finally { busy = false; refresh(); }
  }
  async function next(): Promise<void> {
    if (busy || closed || index + 1 >= recordings.length) return;
    busy = true; errors.textContent = ''; refresh();
    try {
      const nextIndex = index + 1;
      if (player.snapshot().phase === 'playing')
        await player.transition(recordings[nextIndex].id, 1.5);
      else await player.start(recordings[nextIndex].id, ++generation);
      index = nextIndex;
      void prepareNext();
    } catch (error) { report(error); }
    finally { busy = false; refresh(); }
  }
  async function pauseOrResume(): Promise<void> {
    if (busy || closed) return;
    // Invoked directly from the click handler so resume can capture activation.
    const action = player.snapshot().phase === 'paused' ? player.resume() : player.pause();
    busy = true; refresh();
    try { await action; } catch (error) { report(error); }
    finally { busy = false; refresh(); }
  }
  async function stop(): Promise<void> {
    if (busy || closed) return;
    busy = true; refresh();
    try { await player.stop(); } catch (error) { report(error); }
    finally { busy = false; refresh(); }
  }
  async function soundCheck(): Promise<void> {
    if (busy || closed) return;
    const activation = player.unlock();
    busy = true; refresh();
    try {
      if (!await activation) throw new Error('Tap again to enable the browser audio output.');
      await player.soundCheck();
      errors.textContent = 'Listen for the test tone, then confirm using Yes, I heard the test.';
    } catch (error) { report(error); }
    finally { busy = false; refresh(); }
  }
  picker.addEventListener('change', () => {
    files = Array.from(picker.files ?? []);
    selected.textContent = files.length
      ? files.length + ' selected local file(s). The browser may ask to select them again after a reload.'
      : 'No local files selected.';
    recordsReset();
  });
  function recordsReset(): void {
    recordings = []; index = 0; generation += 1;
    void player.stop().catch(report);
    refresh();
  }
  rights.addEventListener('change', () => {
    if (!rights.checked) recordsReset();
    refresh();
  });
  const poll = window.setInterval(() => {
    refresh();
    const s = player.snapshot();
    if (!busy && s.phase === 'playing' && s.foreground &&
      s.remainingSeconds !== null && s.remainingSeconds !== undefined &&
      s.remainingSeconds > 0 && s.remainingSeconds <= 2.3 && index + 1 < recordings.length) {
      void next();
    }
  }, 500);
  window.addEventListener('pagehide', () => {
    closed = true;
    window.clearInterval(poll);
    void player.dispose();
  }, { once: true });
  refresh();
}

if (root) startBrowserKiosk(root);
