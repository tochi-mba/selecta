"""Local speaker-side venue executor. No cloud, browser, R2 or remote media endpoints.

Runs when offline: an authorised engine owns the audio port; Cloud only receives
metadata journals. Hardware/DSP is delegated to an actual local audio adapter.
"""
from __future__ import annotations

import hashlib
import os
import re
import stat
from pathlib import Path
from typing import Callable, Iterable

from .model import (Diagnosis, EngineAuthorisation, Limits, LocalAudioPort, OutputProbe,
                    Policy, Prepared, Recording, Venue, VenueError, Zone)
from .store import VenueStore


class VenueEngine:
    def __init__(self, store: VenueStore, audio: LocalAudioPort, authority: EngineAuthorisation,
                 limits: Limits, *, clock: Callable[[], float]):
        self.store, self.audio, self.authority, self.limits, self.clock = store, audio, authority, limits, clock
        self._verified_files: set[tuple] = set()

    def _get(self, workspace: str, venue_id: str, zone_id: str) -> tuple[Venue, Zone, dict]:
        venue = self.store.config(workspace, venue_id)
        zone = next((z for z in venue.zones if z.id == zone_id), None)
        if zone is None:
            raise VenueError('Unknown zone for this workspace and venue')
        if not self.authority.authorised(workspace, venue_id, venue.engine_id):
            raise VenueError('Local engine does not hold venue authority')
        return venue, zone, self.store.session(workspace, venue_id, zone_id)

    def _clock(self, state: dict, now: float) -> None:
        if state['last_seen_utc'] is not None and now < state['last_seen_utc'] - 120:
            raise VenueError('Device clock moved backwards; new playback unsafe')

    def _path_ok(self, venue: Venue, recording: Recording) -> bool:
        """Resolve symlinks and require a readable regular file under an authorised local root."""
        if (not recording.revision or recording.duration_s <= 0 or not venue.authorised_roots
                or not re.fullmatch(r'[0-9a-f]{64}', recording.sha256)):
            return False
        try:
            path = Path(recording.local_path).resolve(strict=True)
            if not any(path.is_relative_to(Path(root).resolve(strict=True)) for root in venue.authorised_roots):
                return False
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or not os.access(path, os.R_OK):
                return False
            cache_key = (str(path), info.st_dev, info.st_ino, info.st_size,
                         info.st_mtime_ns, info.st_ctime_ns, recording.sha256)
            if cache_key in self._verified_files:
                return True
            if recording.sha256:
                checksum = hashlib.sha256()
                with path.open('rb') as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        checksum.update(chunk)
                if checksum.hexdigest() != recording.sha256:
                    return False
                self._verified_files.add(cache_key)
        except (OSError, ValueError, RuntimeError):
            return False
        return True

    def _eligible(self, venue: Venue, zone: Zone, track_id: str, now: float, *, request: bool = False, ignore_repeat: bool = False) -> Recording | None:
        rec = self.store.recording(venue.workspace_id, venue.venue_id, track_id)
        if rec is None or rec.source_id not in zone.allowed_sources or not self._path_ok(venue, rec):
            return None
        recent = None if ignore_repeat else self.store.last_played(venue.workspace_id, venue.venue_id, zone.id, track_id)
        if not venue.policy.permits(rec, now, recent, request=request, timezone=venue.timezone):
            return None
        return rec

    def _resources(self, venue: Venue) -> None:
        """Admission cannot steal the CPU/RAM reserved for the OS and active audio."""
        active = [z for z in venue.zones if z.enabled]
        if any(z.sample_rate not in self.limits.sample_rates or z.latency_ms > self.limits.max_latency_ms
               or z.cpu_cores <= 0 or z.memory_mb <= 0 for z in active):
            raise VenueError('Unsupported sample rate, latency or zone resource request')
        if sum(z.cpu_cores for z in active) + self.limits.reserve_cpu_cores > self.limits.cpu_cores:
            raise VenueError('Insufficient CPU headroom for all venue zones')
        if sum(z.memory_mb for z in active) + self.limits.reserve_memory_mb > self.limits.memory_mb:
            raise VenueError('Insufficient memory headroom for all venue zones')

    def configure(self, venue: Venue) -> None:
        self._resources(venue)
        if not self.authority.authorised(venue.workspace_id, venue.venue_id, venue.engine_id):
            raise VenueError('Cannot provision this venue on an unauthorised engine')
        self.store.configure(venue)

    def register_local(self, workspace: str, venue_id: str, recording: Recording) -> None:
        venue = self.store.config(workspace, venue_id)
        if not self.authority.authorised(workspace, venue_id, venue.engine_id):
            raise VenueError('Unauthorised device cannot bind recordings')
        if not self._path_ok(venue, recording):
            raise VenueError('Recording unavailable, unverified or outside local sources')
        self.store.put_recording(workspace, venue_id, recording)

    def plan(self, workspace: str, venue_id: str, zone_id: str, track_ids: Iterable[str]) -> dict:
        """Keep current+next two immutable; change only speculative future."""
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        proposed = list(track_ids)
        if not proposed or any(not isinstance(s, str) or not s for s in proposed) or len(proposed) > 200:
            raise VenueError('A programme requires 1..200 canonical track IDs')
        if not zone.enabled:
            raise VenueError('Zone disabled')
        fixed = state['committed']
        if state['state'] in ('playing', 'unknown', 'silent', 'stopped_by_policy') and fixed:
            if proposed[:len(fixed)] != fixed:
                raise VenueError('The currently committed playing window may not be rewritten')
        else:
            fixed = proposed[:3]
        return self.store.mutate(workspace, venue_id, zone_id, committed=fixed,
                                 planned=proposed[len(fixed):], prepared=[])

    def prepare(self, workspace: str, venue_id: str, zone_id: str) -> tuple[str, ...]:
        """Preflight local files and DSP, never queue remote audio or play during preparation."""
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        now = self.clock()
        self._clock(state, now)
        self._resources(venue)
        if not zone.enabled or not (venue.open_at(now) or venue.open_at(now + 45 * 60)):
            return ()
        pending = list(dict.fromkeys(state['committed'] + state['planned'][:8] + list(venue.policy.fallback_ids)))
        result: list[dict] = []
        prior: Recording | None = None
        existing = {(entry['track_id'], entry['revision'], entry.get('from_track'), entry.get('from_revision')): entry
                    for entry in state['prepared']}
        for track_id in pending:
            rec = self._eligible(venue, zone, track_id, now,
                                 ignore_repeat=track_id == state['current'])
            if rec is None or not self.audio.preflight(zone, rec):
                continue
            predecessor = (prior.track_id if prior else None, prior.revision if prior else None)
            prev = existing.get((rec.track_id, rec.revision, *predecessor))
            if prev:
                handle = prev['handle']
            else:
                try:
                    handle = self.audio.prepare(zone, rec, prior)
                except Exception:  # local DSP failure leaves current output untouched
                    continue
            if handle and '://' not in handle:  # forbid cloud/pre-signed media handles
                result.append({'track_id': rec.track_id, 'revision': rec.revision,
                               'from_track': predecessor[0], 'from_revision': predecessor[1],
                               'handle': handle})
                prior = rec
        self.store.mutate(workspace, venue_id, zone_id, prepared=result, last_seen_utc=now)
        return tuple(item['track_id'] for item in result)

    def _prepared(self, state: dict, rec: Recording) -> str | None:
        return next((p['handle'] for p in state['prepared']
                     if p['track_id'] == rec.track_id and p['revision'] == rec.revision), None)

    def _start(self, venue: Venue, zone: Zone, state: dict, track_id: str, now: float, *,
               position_s: float = 0, source: str = 'schedule') -> bool:
        rec = self._eligible(venue, zone, track_id, now, ignore_repeat=source == 'recovery')
        handle = self._prepared(state, rec) if rec else None
        output = self.audio.probe(zone)
        if not rec or not handle or not output.connected or output.latency_ms > self.limits.max_latency_ms:
            self.store.mutate(venue.workspace_id, venue.venue_id, zone.id, state='silent',
                              reason='no_verified_local_recording_or_output')
            return False
        generation = int(state['generation']) + 1
        # Fencing is the physical engine adapter's obligation, not a cloud lease.
        try:
            acknowledged = self.audio.start(zone, rec, handle, generation, position_s)
            verified = self.audio.probe(zone)
        except Exception:
            acknowledged, verified = False, OutputProbe(False, False, False)
        if not acknowledged or not (verified.connected and verified.active and verified.signal_confirmed):
            try:
                self.audio.stop(zone, generation)
            except Exception:
                pass
            self.store.mutate(venue.workspace_id, venue.venue_id, zone.id, generation=generation,
                              state='unknown', reason='physical_output_unconfirmed', last_seen_utc=now)
            return False
        self.store.record_start(venue.workspace_id, venue.venue_id, zone.id,
                                generation=generation, track=track_id,
                                position=position_s, at=now, source=source)
        return True

    def start(self, workspace: str, venue_id: str, zone_id: str) -> bool:
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        now = self.clock()
        self._clock(state, now)
        self._resources(venue)
        if not zone.enabled or not venue.open_at(now) or not state['committed']:
            raise VenueError('No permitted open-hours programme for this zone')
        if state['state'] in ('playing', 'unknown'):
            raise VenueError('A live or unknown speaker must be released before starting')
        wanted = state['committed'][0]
        if self._eligible(venue, zone, wanted, now) and self._prepared(state, self.store.recording(workspace, venue_id, wanted)):
            return self._start(venue, zone, state, wanted, now)
        for fallback in venue.policy.fallback_ids:
            rec = self._eligible(venue, zone, fallback, now)
            if rec and self._prepared(state, rec):
                return self._start(venue, zone, state, fallback, now, source='fallback')
        return self._start(venue, zone, state, wanted, now)

    def stop(self, workspace: str, venue_id: str, zone_id: str, *, reason: str = 'staff') -> bool:
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        if state['state'] == 'stopped':
            return True
        try:
            stopped = self.audio.stop(zone, int(state['generation']))
        except Exception:
            stopped = False
        if not stopped:
            self.store.mutate(workspace, venue_id, zone_id, state='unknown', reason='speaker_release_unconfirmed')
            return False
        self.store.mutate(workspace, venue_id, zone_id, state='stopped', current=None,
                          position=0, checkpoint_at=self.clock(), reason=reason)
        self.store.append_ack(workspace, venue_id, zone_id,
                              event_id=f"{workspace}:{venue_id}:{zone_id}:{state['generation']}:stop", kind='stopped',
                              track=state['current'], at=self.clock(), generation=int(state['generation']))
        return True

    def ended(self, workspace: str, venue_id: str, zone_id: str, *, generation: int) -> bool:
        """Call ONLY after the local port signals the actual audible track ended."""
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        if state['state'] != 'playing' or int(state['generation']) != generation:
            return False  # stale end from another speaker / previous track
        now = self.clock()
        self.store.append_ack(workspace, venue_id, zone_id,
                              event_id=f'{workspace}:{venue_id}:{zone_id}:{generation}:end', kind='ended',
                              track=state['current'], at=now, generation=generation)
        future = state['committed'][1:] + state['planned']
        # Advance the fixed window only after actual hardware's end acknowledgement.
        self.store.mutate(workspace, venue_id, zone_id, committed=future[:3],
                          planned=future[3:], state='stopped', current=None)
        state = self.store.session(workspace, venue_id, zone_id)
        candidates = future + list(venue.policy.fallback_ids)
        for track in dict.fromkeys(candidates):
            if not venue.open_at(now):
                break
            rec = self._eligible(venue, zone, track, now)
            if rec and self._prepared(state, rec) and self._start(venue, zone, state, track, now,
                    source='fallback' if track not in future else 'schedule'):
                return True
        self.store.mutate(workspace, venue_id, zone_id, state='silent', reason='fallback_exhausted')
        return False

    def tick(self, workspace: str, venue_id: str, zone_id: str, *, position_s: float | None = None) -> Diagnosis:
        """Call regularly on the local device, including while internet is disconnected."""
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        now = self.clock()
        self._clock(state, now)
        probe = self.audio.probe(zone)
        current = state['current']
        rec = self.store.recording(workspace, venue_id, current) if current else None
        policy_ok = bool(rec and self._eligible(venue, zone, current, now, ignore_repeat=True))
        if state['state'] == 'playing':
            if not zone.enabled or not venue.open_at(now) or not policy_ok:
                self.stop(workspace, venue_id, zone_id,
                          reason='closed_or_policy_or_rights_changed')
            elif not probe.connected or not probe.active or not probe.signal_confirmed:
                self.store.mutate(workspace, venue_id, zone_id, state='unknown',
                                  reason='output_lost_or_silent')
            else:
                changes = {'last_verified': now, 'last_seen_utc': now, 'checkpoint_at': now}
                if position_s is not None and rec and 0 <= position_s <= rec.duration_s:
                    changes['position'] = position_s
                self.store.mutate(workspace, venue_id, zone_id, **changes)
        return self.diagnose(workspace, venue_id, zone_id)

    def recover(self, workspace: str, venue_id: str, zone_id: str) -> bool:
        """Power-cycle recovery is opt-in and fail-closed; no cloud lease permits replay."""
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        now = self.clock()
        self._clock(state, now)
        self._resources(venue)
        if not venue.open_at(now) or not zone.enabled or not state['current']:
            return False
        rec = self._eligible(venue, zone, state['current'], now, ignore_repeat=True)
        if rec is None or not self._prepared(state, rec):
            return False
        probe = self.audio.probe(zone)
        if not probe.connected or probe.active:  # never duplicate an existing unknown speaker
            return False
        position = float(state['position'])
        if not 0 <= position < rec.duration_s:
            return False
        return self._start(venue, zone, state, rec.track_id, now, position_s=position,
                           source='recovery')

    def admit_background(self, workspace: str, venue_id: str) -> tuple[float, int]:
        """Upper bound for low-priority DSP; caller must enforce in Agent 05 scheduler."""
        venue = self.store.config(workspace, venue_id)
        self._resources(venue)
        active = [z for z in venue.zones if self.store.session(workspace, venue_id, z.id)['state'] == 'playing']
        if any(len(self.store.session(workspace, venue_id, z.id)['prepared']) < 3 for z in active):
            return 0.0, 0  # do not starve imminent seams
        return (max(0.0, self.limits.cpu_cores - self.limits.reserve_cpu_cores - sum(z.cpu_cores for z in venue.zones if z.enabled)),
                max(0, self.limits.memory_mb - self.limits.reserve_memory_mb - sum(z.memory_mb for z in venue.zones if z.enabled)))

    def request_eligible(self, workspace: str, venue_id: str, zone_id: str, track: str) -> bool:
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        return venue.open_at(self.clock()) and zone.enabled and self._eligible(
            venue, zone, track, self.clock(), request=True) is not None

    def diagnose(self, workspace: str, venue_id: str, zone_id: str) -> Diagnosis:
        venue, zone, state = self._get(workspace, venue_id, zone_id)
        probe = self.audio.probe(zone)
        now = self.clock()
        candidates = list(dict.fromkeys(state['committed'] + state['planned'] + list(venue.policy.fallback_ids)))
        missing = tuple(t for t in candidates if not self._eligible(venue, zone, t, now, ignore_repeat=True))
        prepared = tuple(item['track_id'] for item in state['prepared']
                         if self._eligible(venue, zone, item['track_id'], now, ignore_repeat=True))
        runway = sum(self.store.recording(workspace, venue_id, track).duration_s for track in venue.policy.fallback_ids
                     if track in prepared and self._eligible(venue, zone, track, now, ignore_repeat=True))
        actual = ('disconnected' if not probe.connected else 'audible_verified' if
                  probe.active and probe.signal_confirmed else 'silent' if probe.active else 'inactive')
        status = state['state'] if state['state'] != 'playing' or actual == 'audible_verified' else 'unknown'
        return Diagnosis(status, actual, runway, missing, state['reason'],
                         tuple(state['committed']), prepared, tuple(state['planned']), state['last_verified'])
