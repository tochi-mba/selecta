"""Pure harness unit tests. Never present these as LF system acceptance results."""
from __future__ import annotations

import json
import tempfile
import unittest
import wave
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from .audio import make_synthetic_wave, validate_synthetic_wave
from .contracts import (ContractViolation, assert_availability_contract,
                        assert_command_contract, assert_command_result, synthetic_recipe)
from .evidence import Evidence, EvidenceLedger, runtime_environment
from .faults import (DiskBudget, ResourcePressure, corrupt_media, crashed_engine,
                     disconnected_drive, heartbeat_stale, missing_output, power_cycle)
from .fixtures import make_five_of_eight_fleet
from .network import DeterministicNetwork, VirtualClock
from .playback import OutputSafetyMonitor, PlaybackObservation, TakeoverScenario
from .security import (assert_no_media_in_cloud_capture, cross_tenant_command,
                       forbidden_media_probes, malicious_local_paths)
from .venues import OpeningHours, VenueClock, VenueSimulation


class AudioTests(unittest.TestCase):
    def test_repeatable_unique_pcm_and_real_wav_container(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root)
            a = make_synthetic_wave(p / "a.wav", recording_number=1)
            b = make_synthetic_wave(p / "b.wav", recording_number=1)
            c = make_synthetic_wave(p / "c.wav", recording_number=2)
            self.assertEqual(a.pcm_sha256, b.pcm_sha256)
            self.assertNotEqual(a.pcm_sha256, c.pcm_sha256)
            validate_synthetic_wave(a)
            with wave.open(str(a.path), "rb") as file:
                self.assertEqual(file.getnframes(), 960)
                self.assertEqual(file.getnchannels(), 1)

    def test_corrupt_media_and_repair(self):
        with tempfile.TemporaryDirectory() as root:
            a = make_synthetic_wave(Path(root) / "a.wav", recording_number=5)
            with corrupt_media(a.path):
                with self.assertRaises((EOFError, wave.Error)):
                    validate_synthetic_wave(a)
            validate_synthetic_wave(a)


class FleetTests(unittest.TestCase):
    def test_five_of_eight_and_isolation(self):
        with make_five_of_eight_fleet() as fleet:
            a, b = fleet.devices["engine-a"], fleet.devices["engine-b"]
            self.assertEqual(len(a.inventory()), 5)
            self.assertEqual(len(b.inventory()), 8)
            self.assertEqual(len(fleet.devices["controller-phone"].inventory()), 0)
            self.assertNotEqual(a.source_dir, b.source_dir)
            self.assertNotEqual(a.output_dir, b.output_dir)
            self.assertNotEqual(a.root / "identities", b.root / "identities")
            self.assertFalse(a.source_dir.is_relative_to(b.root))
            self.assertEqual([x["state"] for x in a.availability(fleet.recipe_ids, now_ms=1)["tracks"]],
                             ["ready"] * 5 + ["missing"] * 3)
            self.assertEqual([x["state"] for x in b.availability(fleet.recipe_ids, now_ms=1)["tracks"]],
                             ["ready"] * 8)
            self.assertTrue((a.root / "catalogue.json").exists())
            recipe = synthetic_recipe(fleet.recipe_ids)
            self.assertEqual(len(recipe["occurrences"]), 8)
            self.assertEqual(len(recipe["seams"]), 7)

    def test_controller_denied_local_media(self):
        with make_five_of_eight_fleet() as fleet:
            with self.assertRaises(ValueError):
                fleet.add_device("bad-controller", "workspace-a", "controller", recording_numbers=(1,))

    def test_disconnection_crash_and_stale_availability(self):
        with make_five_of_eight_fleet() as fleet:
            device = fleet.devices["engine-a"]
            with disconnected_drive(device):
                self.assertFalse(device.source_dir.exists())
                self.assertFalse(device.inventory())
                self.assertEqual(device.availability(fleet.recipe_ids, now_ms=1)["tracks"][0]["state"],
                                 "source_disconnected")
            with crashed_engine(device):
                self.assertEqual(device.availability(fleet.recipe_ids, now_ms=1)["tracks"][0]["state"],
                                 "unknown")
            self.assertTrue(device.running)
            self.assertTrue(device.drive_connected)
            self.assertTrue(heartbeat_stale(device, now_ms=60_001))
            with missing_output(device):
                self.assertFalse(device.output_connected)
            self.assertTrue(device.output_connected)
            power_cycle(device)
            self.assertEqual(device.generation, 1)
            self.assertTrue(device.power_restored)


class NetworkTests(unittest.TestCase):
    def test_delay_partition_disconnect_and_restore(self):
        net = DeterministicNetwork(VirtualClock(), latency_ms=20)
        net.send("a", "b", {"id": 1})
        self.assertEqual(net.advance(19), [])
        net.partition("a", "b")
        self.assertEqual(net.advance(1), [])
        self.assertEqual(len(net.dropped), 1)
        net.heal("a", "b")
        net.disconnect("b")
        net.send("a", "b", {"id": 2})
        self.assertEqual(net.advance(20), [])
        net.reconnect("b")
        net.send("a", "b", {"id": 3})
        self.assertEqual(net.advance(20)[0].payload, {"id": 3})
        self.assertEqual(len(net.dropped), 2)

    def test_reorder_ack_loss_and_stable_packet_ids(self):
        net = DeterministicNetwork(latency_ms=7)
        a = net.send("engine", "cloud", "one")
        b = net.send("engine", "cloud", "two")
        c = net.send("engine", "cloud", "ack")
        net.reorder([b, a])
        net.drop_packet(c)
        self.assertEqual([pkt.payload for pkt in net.advance(7)], ["two", "one"])
        self.assertEqual([pkt.packet_id for pkt in net.dropped], [c])

    def test_no_real_sleep_and_stable_time(self):
        clock = VirtualClock()
        net = DeterministicNetwork(clock)
        net.send("a", "b", "instant")
        self.assertEqual([x.payload for x in net.flush_due()], ["instant"])
        with self.assertRaises(ValueError):
            clock.advance(-1)


class FaultTests(unittest.TestCase):
    def test_disk_full_and_reclaim(self):
        disk = DiskBudget(64)
        disk.write(63)
        with self.assertRaises(OSError) as err:
            disk.write(2)
        self.assertEqual(err.exception.errno, 28)
        disk.reclaim(20)
        disk.write(2)
        self.assertEqual(disk.used_bytes, 45)

    def test_pressure_prioritises_real_time_over_bulk(self):
        saturated = ResourcePressure(cpu_percent=99, ram_percent=50, gpu_percent=96)
        self.assertFalse(saturated.can_admit(priority="stem"))
        self.assertFalse(saturated.can_admit(priority="export"))
        self.assertTrue(saturated.can_admit(priority="imminent_transition"))
        self.assertTrue(saturated.can_admit(priority="playback"))
        saturated.thermal_throttled = True
        self.assertFalse(saturated.can_admit(priority="imminent_transition"))


class PlaybackTests(unittest.TestCase):
    def test_overlap_oracle_detects_double_audio(self):
        monitor = OutputSafetyMonitor([
            PlaybackObservation("engine-a", "zone-1", "speaker-a", 0, 110, 2),
            PlaybackObservation("engine-b", "zone-1", "speaker-b", 100, 200, 3),
        ])
        with self.assertRaisesRegex(AssertionError, "unsafe overlap"):
            monitor.assert_no_double_audio()

    def test_distinct_zones_and_adjacent_intervals_allowed(self):
        monitor = OutputSafetyMonitor([
            PlaybackObservation("engine-a", "zone-1", "speaker-a", 0, 100, 1),
            PlaybackObservation("engine-b", "zone-2", "speaker-b", 50, 150, 1),
            PlaybackObservation("engine-c", "zone-1", "speaker-c", 100, 200, 2),
        ])
        monitor.assert_no_double_audio()

    def test_same_exclusive_physical_output_cross_zone_rejected(self):
        monitor = OutputSafetyMonitor([
            PlaybackObservation("engine-a", "zone-a", "dac-1", 0, 100, 1),
            PlaybackObservation("engine-a", "zone-b", "dac-1", 20, 110, 1),
        ])
        with self.assertRaisesRegex(AssertionError, "unsafe overlap"):
            monitor.assert_no_double_audio()

    def test_simulated_audio_is_not_physical_evidence(self):
        monitor = OutputSafetyMonitor([PlaybackObservation("a", "z", "speaker", 0, 50, 1)])
        with self.assertRaisesRegex(AssertionError, "UNVERIFIED_PHYSICAL_OUTPUT"):
            monitor.assert_physically_verified(required_outputs={"speaker"})
        with self.assertRaises(ValueError):
            PlaybackObservation("a", "z", "speaker", 0, 50, 1,
                                kind="measured_physical_output")

    def test_concurrent_takeover_and_retries(self):
        scenario = TakeoverScenario(active_device="engine-a")
        self.assertTrue(scenario.prepare("engine-b", media_ready=True, output_ready=True))
        self.assertTrue(scenario.prepare("engine-c", media_ready=True, output_ready=True))
        first = scenario.attempt(operation_id="one", target="engine-b", expected_generation=7,
                                 released_old=True)
        second = scenario.attempt(operation_id="two", target="engine-c", expected_generation=7,
                                  released_old=True)
        self.assertTrue(first.accepted)
        self.assertFalse(second.accepted)
        self.assertEqual(second.reason, "stale_generation")
        self.assertEqual(scenario.attempt(operation_id="one", target="engine-b",
                                          expected_generation=7, released_old=True), first)
        self.assertEqual(scenario.generation, 8)

    def test_partition_and_missing_media_refuse_takeover(self):
        scenario = TakeoverScenario(active_device="engine-a", partitioned_devices={"engine-a"})
        self.assertFalse(scenario.prepare("engine-b", media_ready=False, output_ready=True))
        self.assertEqual(scenario.attempt(operation_id="one", target="engine-b",
                                          expected_generation=7, released_old=True).reason,
                         "preflight_required")
        scenario.prepare("engine-b", media_ready=True, output_ready=True)
        self.assertEqual(scenario.attempt(operation_id="two", target="engine-b",
                                          expected_generation=7, released_old=True).reason,
                         "unsafe_old_speaker_partition")
        self.assertEqual(scenario.active_device, "engine-a")


class VenueTests(unittest.TestCase):
    def test_overnight_open_uses_previous_open_day(self):
        open_hours = OpeningHours(time(22), time(4), closed_weekdays=frozenset({0}))
        tuesday_1am = datetime(2026, 11, 17, 1, tzinfo=timezone.utc)
        self.assertFalse(open_hours.is_open(tuesday_1am))
        wednesday_1am = datetime(2026, 11, 18, 1, tzinfo=timezone.utc)
        self.assertTrue(open_hours.is_open(wednesday_1am))

    def test_dst_fall_back_yields_two_distinct_1am_hours(self):
        clock = VenueClock(datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc))
        earlier = clock.local
        clock.advance(timedelta(hours=1))
        later = clock.local
        self.assertEqual((earlier.hour, later.hour), (1, 1))
        self.assertEqual((earlier.fold, later.fold), (0, 1))
        self.assertNotEqual(earlier.utcoffset(), later.utcoffset())

    def test_spring_forward_and_30_day_outage(self):
        venue = VenueSimulation(VenueClock(datetime(2026, 3, 29, 0, 30, tzinfo=timezone.utc)),
                                OpeningHours(time(0), time(0), all_day=True))
        venue.add_zone("ground", "speaker-one")
        venue.add_zone("upper", "speaker-two")
        with self.assertRaises(ValueError):
            venue.add_zone("third", "speaker-one")
        venue.clock.advance(timedelta(hours=1))
        self.assertEqual(venue.clock.local.hour, 2)
        venue.offline(timedelta(days=30))
        self.assertEqual(venue.outage_seconds, 30 * 24 * 3600)
        venue.record_local_event("ev-1", zone_id="ground", kind="played")
        venue.record_local_event("ev-1", zone_id="ground", kind="played")
        self.assertEqual(len(venue.local_event_journal), 1)
        venue.reconnect()
        self.assertTrue(venue.connected_to_cloud)

    def test_power_restore_requires_all_local_conditions(self):
        venue = VenueSimulation(VenueClock(datetime(2026, 11, 13, 22, 30,
                                                      tzinfo=timezone.utc)),
                                OpeningHours(time(20), time(2)))
        venue.add_zone("main", "speaker")
        self.assertFalse(venue.can_restore_after_power("main"))
        zone = venue.zones["main"]
        zone.checkpoint = "checkpoint-2"
        self.assertTrue(venue.can_restore_after_power("main"))
        zone.rights_ok = False
        self.assertFalse(venue.can_restore_after_power("main"))


class SecurityTests(unittest.TestCase):
    def test_embedded_audio_probes_trigger_capture_oracle(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = make_synthetic_wave(Path(root) / "beep.wav", recording_number=3)
            probes = forbidden_media_probes(fixture)
            self.assertEqual(len(probes), 7)
            for probe in probes:
                if probe.name == "pcm_integer_samples":
                    # Only first 256 bytes of WAV; API must reject via schema, byte oracle
                    # intentionally does not pretend to detect every encoding.
                    continue
                with self.subTest(probe.name):
                    with self.assertRaisesRegex(AssertionError, "forbidden"):
                        assert_no_media_in_cloud_capture(probe.payload, fixture)
            assert_no_media_in_cloud_capture({"device_id": "opaque-1", "status": "ready"}, fixture)

    def test_cross_tenant_and_path_adversaries(self):
        with make_five_of_eight_fleet() as fleet:
            foreign = cross_tenant_command(target_device_id="engine-a",
                                           foreign_workspace="workspace-b")
            with self.assertRaisesRegex(ContractViolation, "cross-tenant"):
                assert_command_contract(foreign, target_workspace="workspace-a",
                                        device_id="engine-a")
            self.assertEqual(len(malicious_local_paths()), 6)


class ContractTests(unittest.TestCase):
    def test_availability_shape_and_false_ready(self):
        with make_five_of_eight_fleet() as fleet:
            availability = fleet.devices["engine-a"].availability(fleet.recipe_ids, now_ms=5)
            assert_availability_contract(availability, device_id="engine-a",
                                         revision="rev-synthetic-1", expected_occurrences=8)
            availability["status"] = "ready"
            with self.assertRaisesRegex(ContractViolation, "falsely ready"):
                assert_availability_contract(availability, device_id="engine-a",
                                             revision="rev-synthetic-1")
            availability["tracks"][0]["file_path"] = "/private/music.wav"
            with self.assertRaisesRegex(ContractViolation, "forbidden cloud field"):
                assert_availability_contract(availability, device_id="engine-a",
                                             revision="rev-synthetic-1")

    def test_command_ttl_and_ack_truth(self):
        with make_five_of_eight_fleet() as fleet:
            cmd = fleet.command_for("engine-a", actor_workspace="workspace-a", generation=2)
            assert_command_contract(cmd, target_workspace="workspace-a", device_id="engine-a", now=3)
            with self.assertRaisesRegex(ContractViolation, "expired"):
                assert_command_contract(cmd, target_workspace="workspace-a", device_id="engine-a", now=10_001)
        with self.assertRaisesRegex(ContractViolation, "not actual local application"):
            assert_command_result({"status": "applied"}, local_ack=False)
        assert_command_result({"status": "accepted"}, local_ack=False)


class EvidenceTests(unittest.TestCase):
    def sample(self, *, klass="simulated", outcome="PASS", actual="simulation-only outcome",
               reviewer=None, link=None):
        return Evidence(task_id="LF-0482-03", adr="ADR-0482", source_commit="deadbeef",
                        test_case="partition", environment=runtime_environment(),
                        expected_result="deny unsafe takeover", actual_result=actual,
                        outcome=outcome, evidence_class=klass, reviewer=reviewer,
                        evidence_link=link, residual_risks=["real hardware untested"],
                        migration_stage="pre-integration", next_decision="await independent hardware")

    def test_simulated_does_not_satisfy_release_gate(self):
        ledger = EvidenceLedger([self.sample()])
        is_go, failures = ledger.gate(mandatory_cases=["partition"])
        self.assertFalse(is_go)
        self.assertIn("no independently evidenced", failures[0])

    def test_integrated_provenance_and_atomic_roundtrip(self):
        with self.assertRaises(ValueError):
            self.sample(klass="physical", actual="measured waveform", reviewer=None, link=None)
        ledger = EvidenceLedger([self.sample()])
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "output" / "ledger.json"
            ledger.write(target)
            self.assertEqual(EvidenceLedger.read(target).records, ledger.records)
            self.assertFalse(target.with_name("ledger.json.tmp").exists())

    def test_simulated_success_requires_explicit_label(self):
        with self.assertRaisesRegex(ValueError, "simulation"):
            self.sample(actual="all hardware verified")


if __name__ == "__main__":
    unittest.main()
