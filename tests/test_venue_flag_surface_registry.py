"""Venue flags without a released Cloud page have explicit, reviewed exclusions.

Adding a UI requires replacing that exclusion with a real cloud.* surface so the
browser sweep can visit it. These tests do not turn headless safety work into a
fictional customer page.
"""

from dataclasses import replace

from selecta import flags


EXPECTED = {
    "venue.continuity": "headless",
    "venue.fault_injection": "rehearsal",
    "venue.speakers": "unreleased",
    "venue.staff_dashboard": "unreleased",
    "venue.moderated_requests": "headless",
    "venue.learning": "headless",
    "venue.rights_gate": "headless",
    "venue.roles": "headless",
    "venue.safe_gain": "headless",
    "venue.health": "operations",
    "venue.soak": "rehearsal",
    "venue.rollout_gates": "operations",
}


def test_all_venue_cloud_exclusions_have_real_metadata_and_safe_defaults():
    registry = flags.registry()
    venue = {id: value for id, value in registry.items() if id.startswith("venue.")}
    assert set(venue) == set(EXPECTED)
    for id, spec in venue.items():
        assert spec.cloud_surface_kind == EXPECTED[id], id
        assert spec.cloud_surface_reason and len(spec.cloud_surface_reason.strip()) >= 20, id
        assert spec.owner == "autopilot", id
        assert spec.modes == ("cloud",), id
        assert spec.default is False, id
        assert "autopilot.venue_mode" in spec.requires or "venue.continuity" in spec.requires, id
        assert not any(surface.startswith("cloud.") for surface in spec.surfaces), id
        assert flags.resolve("")[id].on is False, id
        assert flags.resolve("+autopilot.venue_mode")[id].on is False, id


def test_registry_rejects_fake_exclusions_and_requires_real_justifications():
    original = flags.registry()["venue.staff_dashboard"]

    def violations(**changes):
        registry = {**flags.registry(), original.id: replace(original, **changes)}
        return "\n".join(flags.problems(registry))

    assert "cannot also exclude" in violations(surfaces=("cloud.settings",))
    assert "cloud_surface_reason must explain" in violations(cloud_surface_reason="")
    assert "cloud_surface_kind must be one of" in violations(cloud_surface_kind="placeholder")
    assert "cloud_surface_reason needs cloud_surface_kind" in violations(cloud_surface_kind=None)
    assert "a Cloud exclusion needs cloud mode" in violations(modes=("local",))


def test_venue_dashboard_is_not_mounted_as_a_cloud_customer_page(tmp_path):
    from cloud_helpers import make_cloud_app

    app, engine, _ = make_cloud_app(tmp_path)
    try:
        assert not any(
            getattr(route, "path", "").startswith("/api/venue/staff/")
            for route in app.routes
        ), "Mounting staff routes requires a real Cloud surface and authorization tests"
    finally:
        engine.dispose()
