"""Runtime modes (ADR-0392, test plan 18.15): the default, bad values, adapters per mode,
`require_mode` and `available_in_mode`."""

from __future__ import annotations

import threading

import pytest

from selecta import flags, modes
from selecta.flags import Flag
from selecta.modes import (
    ALL_MODES,
    DEFAULT,
    ENV,
    AdapterError,
    Mode,
    ModeError,
    WrongMode,
    available_in_mode,
    current_mode,
    parse_mode,
    require_mode,
)

NAMES = ("test.artifacts", "test.identity", "test_db", "test.other")


@pytest.fixture(autouse=True)
def _clean_registry(monkeypatch):
    monkeypatch.delenv(ENV, raising=False)
    for name in NAMES:
        modes.unregister(name)
    yield
    for name in NAMES:
        modes.unregister(name)


# -- the mode itself --------------------------------------------------------------------------


def test_local_is_the_default_when_the_mode_is_not_set():
    assert DEFAULT is Mode.LOCAL
    assert current_mode() is Mode.LOCAL


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_a_blank_mode_means_the_default(monkeypatch, blank):
    monkeypatch.setenv(ENV, blank)
    assert current_mode() is Mode.LOCAL


@pytest.mark.parametrize(
    ("raw", "mode"),
    [("cloud", Mode.CLOUD), ("CLOUD", Mode.CLOUD), ("  Local ", Mode.LOCAL), ("local", Mode.LOCAL)],
)
def test_the_mode_ignores_case_and_surrounding_spaces(monkeypatch, raw, mode):
    monkeypatch.setenv(ENV, raw)
    assert current_mode() is mode


def test_the_mode_is_read_each_time_so_a_patch_switches_it(monkeypatch):
    monkeypatch.setenv(ENV, "cloud")
    assert current_mode() is Mode.CLOUD
    monkeypatch.setenv(ENV, "local")
    assert current_mode() is Mode.LOCAL


@pytest.mark.parametrize("bad", ["clouds", "saas", "local,cloud", "0", "None"])
def test_an_invalid_mode_names_the_choices(monkeypatch, bad):
    monkeypatch.setenv(ENV, bad)
    with pytest.raises(ModeError) as caught:
        current_mode()
    text = str(caught.value)
    assert ENV in text
    assert repr(bad) in text
    for choice in ALL_MODES:
        assert choice in text
    assert isinstance(caught.value, ValueError)


def test_parse_mode_passes_a_mode_through_unchanged():
    assert parse_mode(Mode.CLOUD) is Mode.CLOUD
    assert parse_mode("cloud") is Mode.CLOUD
    assert ALL_MODES == ("local", "cloud")


# -- require_mode -----------------------------------------------------------------------------


def test_require_mode_allows_the_running_mode(monkeypatch):
    require_mode("local")
    monkeypatch.setenv(ENV, "cloud")
    require_mode(Mode.CLOUD)


def test_require_mode_refuses_the_other_mode_and_says_which_is_needed(monkeypatch):
    with pytest.raises(WrongMode) as caught:
        require_mode("cloud")
    assert caught.value.needed is Mode.CLOUD
    assert caught.value.current is Mode.LOCAL
    assert f"{ENV}=cloud" in str(caught.value)
    assert "running in local" in str(caught.value)

    monkeypatch.setenv(ENV, "cloud")
    with pytest.raises(WrongMode) as caught:
        require_mode(Mode.LOCAL)
    assert caught.value.needed is Mode.LOCAL


def test_require_mode_refuses_an_invalid_mode_name():
    with pytest.raises(ModeError):
        require_mode("hybrid")


# -- adapters ---------------------------------------------------------------------------------


def test_adapters_resolve_to_the_running_modes_factory_only(monkeypatch):
    calls: list[str] = []

    def local_factory():
        calls.append("local")
        return "local folder"

    def cloud_factory():
        calls.append("cloud")
        return "r2"

    modes.register("test.artifacts", "local", local_factory)
    modes.register("test.artifacts", Mode.CLOUD, cloud_factory)

    assert modes.get("test.artifacts") == "local folder"
    assert calls == ["local"]

    monkeypatch.setenv(ENV, "cloud")
    assert modes.get("test.artifacts") == "r2"
    assert calls == ["local", "cloud"]
    assert set(modes.registered("test.artifacts")) == {Mode.LOCAL, Mode.CLOUD}


def test_an_adapter_is_built_once_and_kept_until_forgotten():
    built: list[object] = []

    def factory():
        built.append(object())
        return built[-1]

    modes.register("test.artifacts", "local", factory)
    first = modes.get("test.artifacts")
    assert modes.get("test.artifacts") is first
    assert len(built) == 1

    modes.forget("test.artifacts")
    second = modes.get("test.artifacts")
    assert second is not first
    assert len(built) == 2
    assert modes.registered("test.artifacts") == (Mode.LOCAL,)


def test_forget_without_a_name_drops_every_built_adapter():
    modes.register("test.artifacts", "local", object)
    modes.register("test.identity", "local", object)
    one, two = modes.get("test.artifacts"), modes.get("test.identity")
    modes.forget()
    assert modes.get("test.artifacts") is not one
    assert modes.get("test.identity") is not two


def test_forget_of_one_name_keeps_the_others():
    modes.register("test.artifacts", "local", object)
    modes.register("test.identity", "local", object)
    kept = modes.get("test.identity")
    modes.get("test.artifacts")
    modes.forget("test.artifacts")
    assert modes.get("test.identity") is kept


def test_an_adapter_registered_only_for_the_other_mode_says_where_it_is(monkeypatch):
    modes.register("test.identity", "cloud", lambda: "authkit")
    with pytest.raises(AdapterError) as caught:
        modes.get("test.identity")
    text = str(caught.value)
    assert "no local adapter called 'test.identity'" in text
    assert "registered for cloud only" in text


def test_an_unknown_adapter_is_a_lookup_error_without_a_where_clause():
    with pytest.raises(AdapterError) as caught:
        modes.get("test.other")
    assert "registered for" not in str(caught.value)
    assert isinstance(caught.value, LookupError)


def test_registering_the_same_name_and_mode_twice_is_refused_unless_replacing():
    modes.register("test_db", "local", lambda: "sqlite")
    with pytest.raises(AdapterError, match="already has a local adapter"):
        modes.register("test_db", "local", lambda: "other")
    assert modes.get("test_db") == "sqlite"

    modes.register("test_db", "local", lambda: "fake", replace=True)
    # Replacing drops the adapter already built, so the fake is what comes back.
    assert modes.get("test_db") == "fake"


@pytest.mark.parametrize("bad", ["", "Artifacts", "1db", "db-store", "db store", "../db", "db/x"])
def test_adapter_names_are_lower_case_words(bad):
    with pytest.raises(AdapterError, match="lower case"):
        modes.register(bad, "local", object)


def test_an_adapter_factory_must_be_callable():
    with pytest.raises(AdapterError, match="isn't callable"):
        modes.register("test_db", "local", "not a factory")  # type: ignore[arg-type]


def test_registering_for_an_invalid_mode_is_refused():
    with pytest.raises(ModeError):
        modes.register("test_db", "hybrid", object)


def test_unregister_forgets_factories_and_built_adapters():
    modes.register("test_db", "local", object)
    modes.register("test.other", "local", object)
    modes.get("test_db")
    modes.unregister("test_db")
    assert modes.registered("test_db") == ()
    with pytest.raises(AdapterError):
        modes.get("test_db")
    assert modes.registered("test.other") == (Mode.LOCAL,)


def test_unregister_without_a_name_clears_everything(monkeypatch):
    saved = dict(modes.adapters._factories)
    saved_built = dict(modes.adapters._built)
    try:
        modes.register("test_db", "local", object)
        modes.unregister()
        assert modes.registered("test_db") == ()
        assert not modes.adapters._factories
        assert not modes.adapters._built
    finally:
        modes.adapters._factories.update(saved)
        modes.adapters._built.update(saved_built)


def test_concurrent_first_gets_build_one_adapter():
    built: list[object] = []
    gate = threading.Barrier(8)

    def factory():
        built.append(object())
        return built[-1]

    modes.register("test.artifacts", "local", factory)
    seen: list[object] = []

    def ask():
        gate.wait()
        seen.append(modes.get("test.artifacts"))

    threads = [threading.Thread(target=ask) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(built) == 1
    assert all(item is built[0] for item in seen)


def test_importing_modes_builds_nothing():
    # Nothing is registered at import: the registry only holds what tests or startup added.
    assert all(name not in {n for n, _ in modes.adapters._factories} for name in NAMES)


# -- available_in_mode ------------------------------------------------------------------------


def _flag(flag_id: str, modes_field: tuple[str, ...]) -> Flag:
    return Flag(id=flag_id, area="test", label=flag_id, about="test flag", modes=modes_field)


@pytest.fixture
def fake_registry(monkeypatch):
    registry = {
        "test.both": _flag("test.both", ("local", "cloud")),
        "test.cloud_only": _flag("test.cloud_only", ("cloud",)),
        "test.local_only": _flag("test.local_only", ("local",)),
    }
    monkeypatch.setattr(flags, "registry", lambda: registry)
    return registry


def test_available_in_mode_follows_the_flags_modes_field(fake_registry):
    assert available_in_mode("test.both", "local")
    assert available_in_mode("test.both", "cloud")
    assert available_in_mode("test.cloud_only", Mode.CLOUD)
    assert not available_in_mode("test.cloud_only", Mode.LOCAL)
    assert available_in_mode("test.local_only", "local")
    assert not available_in_mode("test.local_only", "cloud")


def test_available_in_mode_defaults_to_the_running_mode(fake_registry, monkeypatch):
    assert not available_in_mode("test.cloud_only")
    monkeypatch.setenv(ENV, "cloud")
    assert available_in_mode("test.cloud_only")
    assert not available_in_mode("test.local_only")


def test_a_flag_without_a_modes_field_works_in_both(monkeypatch):
    class Bare:
        id = "test.bare"

    monkeypatch.setattr(flags, "registry", lambda: {"test.bare": Bare()})
    assert available_in_mode("test.bare", "local")
    assert available_in_mode("test.bare", "cloud")


def test_a_flag_listing_modes_as_enum_members_is_read_by_value(monkeypatch):
    class Enumerated:
        id = "test.enum"
        modes = (Mode.CLOUD,)

    monkeypatch.setattr(flags, "registry", lambda: {"test.enum": Enumerated()})
    assert available_in_mode("test.enum", "cloud")
    assert not available_in_mode("test.enum", "local")


def test_available_in_mode_refuses_an_unknown_flag(fake_registry):
    with pytest.raises(KeyError, match="test.missing"):
        available_in_mode("test.missing", "local")


def test_available_in_mode_refuses_an_invalid_mode(fake_registry):
    with pytest.raises(ModeError):
        available_in_mode("test.both", "hybrid")


def test_the_real_registry_marks_cloud_only_features_as_unavailable_locally():
    registry = flags.registry()
    cloud_only = [flag.id for flag in registry.values() if tuple(flag.modes) == ("cloud",)]
    assert cloud_only, "the registry should hold at least one cloud-only feature"
    for flag_id in cloud_only:
        assert available_in_mode(flag_id, "cloud")
        assert not available_in_mode(flag_id, "local")
