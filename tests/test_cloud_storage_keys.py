"""Object keys, display names and the multipart part policy (ADR-0397, ADR-0398, test plan 18.15).

Keys are built from ids only and checked against exactly four layouts; names a browser sends are
cleaned for display and never reach a key; parts follow R2's rules with one fixed 8 MiB size.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

import pytest
from hypothesis import given
from hypothesis import strategies as st

from selecta.storage import keys
from selecta.storage.keys import (
    MAX_KEY_LENGTH,
    Bucket,
    UnsafeKey,
    derived_key,
    derived_prefix,
    export_key,
    input_hash,
    is_safe_key,
    original_key,
    staging_key,
    validate_key,
    workspace_of,
    workspace_prefix,
)
from selecta.storage.names import (
    DEFAULT_CONTENT_TYPE,
    MAX_DISPLAY_NAME,
    UNTITLED,
    content_type,
    display_name,
    sha256_hex,
)
from selecta.storage.objects import GiB, MiB, Part
from selecta.storage.parts import (
    MAX_FILE_BYTES,
    MAX_PARTS,
    MIN_PART_SIZE,
    PART_SIZE,
    check_parts,
    plan_parts,
)

WS = "0192f0c1-7a3b-7c00-8000-000000000001"
HASH = "ab" * 32

# The four layouts, written out again here so the test doesn't trust the module's own regexes.
_SEG = r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}"
LAYOUTS = {
    Bucket.ORIGINALS: re.compile(rf"w/{_SEG}/a/{_SEG}"),
    Bucket.EXPORTS: re.compile(rf"w/{_SEG}/x/{_SEG}\.flac"),
    Bucket.DERIVED: re.compile(
        rf"w/{_SEG}/[a-z][a-z0-9_]{{1,31}}/[0-9a-f]{{64}}/attempts/{_SEG}/"
        rf"{_SEG}(?:\.[A-Za-z0-9]{{1,16}}){{0,2}}"
    ),
    Bucket.STAGING: re.compile(rf"s/{_SEG}/object"),
}


def _matching_layouts(key: str) -> list[Bucket]:
    return [bucket for bucket, layout in LAYOUTS.items() if layout.fullmatch(key)]


# -- building keys ----------------------------------------------------------------------------


def test_each_builder_makes_a_key_in_its_own_bucket():
    assert original_key(WS, "asset-1") == f"w/{WS}/a/asset-1"
    assert export_key(WS, "export_1") == f"w/{WS}/x/export_1.flac"
    assert staging_key("session-1") == "s/session-1/object"
    derived = derived_key(WS, "features", HASH, "attempt-1", "features.npz")
    assert derived == f"w/{WS}/features/{HASH}/attempts/attempt-1/features.npz"
    assert validate_key(original_key(WS, "asset-1")) is Bucket.ORIGINALS
    assert validate_key(export_key(WS, "export_1")) is Bucket.EXPORTS
    assert validate_key(staging_key("session-1")) is Bucket.STAGING
    assert validate_key(derived) is Bucket.DERIVED


def test_prefixes_cover_exactly_one_workspace_and_one_derived_artifact():
    prefix = workspace_prefix(WS)
    assert prefix == f"w/{WS}/"
    assert original_key(WS, "a1").startswith(prefix)
    assert not original_key(WS + "0", "a1").startswith(prefix)
    one = derived_prefix(WS, "stems", HASH)
    assert derived_key(WS, "stems", HASH, "attempt-9", "vocals.flac").startswith(one)
    assert not derived_key(WS, "stems", "cd" * 32, "attempt-9", "vocals.flac").startswith(one)


def test_workspace_of_reads_the_owner_and_staging_keys_have_none():
    assert workspace_of(original_key(WS, "a1")) == WS
    assert workspace_of(export_key(WS, "e1")) == WS
    assert workspace_of(derived_key(WS, "waves", HASH, "t1", "peaks.json")) == WS
    assert workspace_of(staging_key("session-1")) is None
    with pytest.raises(UnsafeKey):
        workspace_of("w/../a/b")


@pytest.mark.parametrize(
    "user_text",
    [
        "My Song.mp3",
        "Beyonce - Halo",
        "../../etc/passwd",
        "track/01",
        "a\\b",
        "song\x00.mp3",
        "Café",
        "\u202egnp.exe",
        "x" * 65,
        "",
        ".hidden",
        "-flag",
        "_under",
    ],
)
def test_no_user_text_can_become_part_of_a_key(user_text):
    for build in (
        lambda value: original_key(WS, value),
        lambda value: original_key(value, "asset-1"),
        lambda value: export_key(WS, value),
        lambda value: staging_key(value),
        lambda value: derived_key(WS, "features", HASH, value, "features.npz"),
        lambda value: derived_key(WS, "features", HASH, "attempt-1", value),
        lambda value: workspace_prefix(value),
    ):
        with pytest.raises(UnsafeKey):
            build(user_text)


def test_a_kind_can_never_shadow_the_originals_or_exports_folders():
    for kind in ("a", "x", "A", "Features", "1x", "feat-ures", "f" * 33):
        with pytest.raises(UnsafeKey):
            derived_key(WS, kind, HASH, "attempt-1", "features.npz")
    with pytest.raises(UnsafeKey):
        derived_key(WS, "features", "AB" * 32, "attempt-1", "features.npz")
    with pytest.raises(UnsafeKey):
        derived_key(WS, "features", "ab" * 31, "attempt-1", "features.npz")


def test_derived_file_names_allow_at_most_two_short_extensions():
    assert validate_key(derived_key(WS, "stems", HASH, "t1", "mix.tar.gz")) is Bucket.DERIVED
    with pytest.raises(UnsafeKey):
        derived_key(WS, "stems", HASH, "t1", "a.b.c.d")
    with pytest.raises(UnsafeKey):
        derived_key(WS, "stems", HASH, "t1", "name." + "x" * 17)


def test_builders_refuse_values_that_are_not_text():
    with pytest.raises(UnsafeKey):
        original_key(WS, 7)  # type: ignore[arg-type]
    with pytest.raises(UnsafeKey):
        staging_key(None)  # type: ignore[arg-type]


# -- the validator ----------------------------------------------------------------------------


GOOD = original_key(WS, "asset-1")


@pytest.mark.parametrize(
    "bad",
    [
        "../outside",
        f"w/{WS}/a/..",
        f"w/{WS}/a/../b",
        f"w/{WS}/../{WS}/a/b",
        "w/../a/b",
        "/" + GOOD,
        "//" + GOOD,
        GOOD + "/",
        GOOD.replace("/", "//", 1),
        GOOD.replace("/", "\\"),
        GOOD + "\\x",
        GOOD + "\x00",
        GOOD.replace("asset", "as\x00set"),
        GOOD + "\n",
        GOOD.replace("asset", "as\tset"),
        GOOD.replace("asset", "as\x7fset"),
        GOOD.replace("asset", "as\x1bset"),
        GOOD.replace("asset", "as set"),
        GOOD.replace("asset", "as%2fset"),
        GOOD.replace("/a/", "/A/"),
        "w/" + WS + "/a/asset-1?x=1",
        "w/" + WS + "/a/asset-1#frag",
        "s/session-1/object/extra",
        "s/session-1/objects",
        f"w/{WS}/x/export-1.mp3",
        f"w/{WS}/x/export-1",
        "",
        ".",
        "w",
        "w/" + "a" * MAX_KEY_LENGTH,
    ],
)
def test_the_validator_refuses_paths_outside_the_layouts(bad):
    with pytest.raises(UnsafeKey):
        validate_key(bad)
    assert not is_safe_key(bad)


@pytest.mark.parametrize(
    ("look_alike", "what"),
    [
        (GOOD.replace("/", "\u2215"), "division slash"),
        (GOOD.replace("/", "\uff0f"), "fullwidth solidus"),
        (GOOD.replace("/", "\u2044"), "fraction slash"),
        (GOOD.replace("a", "\u0430"), "Cyrillic a"),
        (GOOD.replace("asset", "\uff41sset"), "fullwidth a"),
        (GOOD.replace("asset-1", "asset\u20101"), "Unicode hyphen"),
        (GOOD.replace("asset", "a\u200bsset"), "zero width space"),
        (GOOD.replace("asset", "\u202easset"), "right-to-left override"),
        (GOOD.replace("..", "\u2025") if ".." in GOOD else f"w/{WS}/a/\u2025", "two dot leader"),
        (f"w/{WS}/a/\uff0e\uff0e", "fullwidth full stops"),
        (GOOD.replace("1", "\u0661"), "Arabic-Indic digit one"),
        (GOOD.replace("asset", "a\u0301sset"), "combining accent"),
    ],
)
def test_the_validator_refuses_unicode_look_alikes(look_alike, what):
    with pytest.raises(UnsafeKey):
        validate_key(look_alike)


@pytest.mark.parametrize("not_text", [None, 1, b"w/a/a/b", ["w", "a"]])
def test_the_validator_refuses_values_that_are_not_text(not_text):
    with pytest.raises(UnsafeKey):
        validate_key(not_text)  # type: ignore[arg-type]
    assert not is_safe_key(not_text)  # type: ignore[arg-type]


def test_keys_in_the_layouts_are_safe():
    for key in (GOOD, export_key(WS, "e1"), staging_key("s1"),
                derived_key(WS, "waves", HASH, "t1", "peaks.json")):
        assert is_safe_key(key)


def test_every_key_is_well_under_the_length_limit():
    longest = derived_key(
        "w" * 64, "k" * 32, HASH, "t" * 64, "n" * 64 + "." + "e" * 16 + "." + "f" * 16
    )
    assert validate_key(longest) is Bucket.DERIVED
    assert len(longest) <= MAX_KEY_LENGTH


_KEY_ALPHABET = st.sampled_from(
    list("ws/ax.-_0aZ\\:%?#~ ")
    + ["..", "//", "\x00", "\n", "\u202e", "\u2215", "\uff0f", "\u0430", "attempts", "object"]
    + ["flac", HASH, WS, "features"]
)


@given(st.lists(_KEY_ALPHABET, max_size=24).map("".join))
def test_fuzz_no_input_yields_a_key_outside_the_four_layouts(text):
    try:
        bucket = validate_key(text)
    except UnsafeKey:
        assert _matching_layouts(text) == [] or not text.isascii() or len(text) > MAX_KEY_LENGTH
        return
    assert _matching_layouts(text) == [bucket]
    assert ".." not in text.split("/")
    assert not text.startswith("/")
    assert "\\" not in text
    assert text.isascii() and text.isprintable()


@given(st.text(max_size=80))
def test_fuzz_arbitrary_text_is_either_refused_or_in_exactly_one_layout(text):
    if is_safe_key(text):
        assert len(_matching_layouts(text)) == 1
    else:
        with pytest.raises(UnsafeKey):
            validate_key(text)


@given(st.text(max_size=70), st.text(max_size=70))
def test_fuzz_builders_never_produce_a_key_the_validator_would_refuse(workspace, item):
    for build, bucket in (
        (lambda: original_key(workspace, item), Bucket.ORIGINALS),
        (lambda: export_key(workspace, item), Bucket.EXPORTS),
        (lambda: staging_key(item), Bucket.STAGING),
        (lambda: derived_key(workspace, "features", HASH, item, "f.npz"), Bucket.DERIVED),
    ):
        try:
            key = build()
        except UnsafeKey:
            continue
        assert validate_key(key) is bucket
        assert _matching_layouts(key) == [bucket]
        if bucket is not Bucket.STAGING:
            assert workspace_of(key) == workspace


# -- input_hash -------------------------------------------------------------------------------


def test_input_hash_is_64_hex_digits_and_a_valid_derived_folder():
    value = input_hash(WS, "features", {"analysis_version": 7, "song": "c0ffee"})
    assert re.fullmatch(r"[0-9a-f]{64}", value)
    assert validate_key(derived_key(WS, "features", value, "t1", "features.npz"))


def test_input_hash_ignores_key_order_at_every_level():
    first = {"analysis_version": 7, "settings": {"a": 1, "b": [1, 2]}, "song": "x"}
    second = {"song": "x", "settings": {"b": [1, 2], "a": 1}, "analysis_version": 7}
    assert input_hash(WS, "features", first) == input_hash(WS, "features", second)


def test_input_hash_keeps_list_order_meaningful():
    one = input_hash(WS, "stems", {"versions": [1, 2]})
    two = input_hash(WS, "stems", {"versions": [2, 1]})
    assert one != two


def test_input_hash_differs_per_workspace():
    inputs = {"analysis_version": 7, "song": "same bytes"}
    assert input_hash(WS, "features", inputs) != input_hash("another-ws", "features", inputs)


def test_input_hash_differs_per_kind():
    inputs = {"analysis_version": 7}
    assert input_hash(WS, "features", inputs) != input_hash(WS, "waves", inputs)


@pytest.mark.parametrize(
    "change",
    [
        {"analysis_version": 8},
        {"versions": {"engine": "1.2.4", "model": "m1"}},
        {"versions": {"engine": "1.2.3", "model": "m2"}},
    ],
)
def test_input_hash_changes_with_any_version(change):
    base = {"analysis_version": 7, "versions": {"engine": "1.2.3", "model": "m1"}, "song": "s"}
    changed = {**base, **change}
    assert input_hash(WS, "features", base) != input_hash(WS, "features", changed)


@given(
    st.dictionaries(
        st.text(min_size=1, max_size=8),
        st.one_of(st.integers(), st.text(max_size=8), st.booleans(), st.none()),
        max_size=6,
    ),
    st.randoms(use_true_random=False),
)
def test_fuzz_input_hash_is_the_same_for_any_ordering(inputs, rng):
    inputs = {"engine_version": 3, **inputs}
    items = list(inputs.items())
    rng.shuffle(items)
    assert input_hash(WS, "features", dict(items)) == input_hash(WS, "features", inputs)


def test_input_hash_needs_a_version():
    with pytest.raises(ValueError, match="versions"):
        input_hash(WS, "features", {"song": "x", "settings": {"version": 1}})
    assert input_hash(WS, "features", {"Model_VERSION": 1})


def test_input_hash_refuses_values_that_are_not_plain_json():
    with pytest.raises(TypeError):
        input_hash(WS, "features", [("analysis_version", 1)])  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        input_hash(WS, "features", {"analysis_version": 1, "when": {1, 2}})
    with pytest.raises(TypeError):
        input_hash(WS, "features", {"analysis_version": 1, "obj": object()})
    with pytest.raises(ValueError):
        input_hash(WS, "features", {"analysis_version": float("nan")})


def test_input_hash_refuses_unsafe_workspaces_and_kinds():
    with pytest.raises(UnsafeKey):
        input_hash("../ws", "features", {"analysis_version": 1})
    with pytest.raises(UnsafeKey):
        input_hash(WS, "a", {"analysis_version": 1})


def test_input_hash_format_is_pinned():
    # Changing the canonical form would orphan every derived artifact already stored.
    assert keys.HASH_FORMAT == "selecta.artifact/1"
    canonical = (
        '{"format":"selecta.artifact/1","inputs":{"analysis_version":1},'
        '"kind":"features","workspace":"ws1"}'
    )
    expected = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    assert expected == "fc6bd6621987485d3a23856c1eeeebda66074dbdff9c63af733357e95ea04bce"
    assert input_hash("ws1", "features", {"analysis_version": 1}) == expected


# -- display names ----------------------------------------------------------------------------


def test_display_names_drop_nul_and_control_characters():
    assert display_name("song\x00.mp3") == "song.mp3"
    assert display_name("a\x07b\x1bc\x7f.mp3") == "abc.mp3"


def test_display_names_drop_the_right_to_left_override_and_other_format_characters():
    spoofed = "invoice\u202egnp.exe"
    cleaned = display_name(spoofed)
    assert "\u202e" not in cleaned
    assert cleaned == "invoicegnp.exe"
    for mark in ("\u202d", "\u2066", "\u2067", "\u2068", "\u2069", "\u200b", "\ufeff", "\u200f"):
        assert mark not in display_name(f"a{mark}b.mp3")


def test_very_long_display_names_are_cut_to_the_limit():
    cleaned = display_name("x" * 5000 + ".mp3")
    assert len(cleaned) == MAX_DISPLAY_NAME == 200


def test_display_names_keep_emoji_and_non_latin_letters():
    assert display_name("\U0001f3b6 Dance \U0001f483.flac") == "\U0001f3b6 Dance \U0001f483.flac"
    assert display_name("\u65e5\u672c\u306e\u6b4c.mp3") == "\u65e5\u672c\u306e\u6b4c.mp3"


def test_display_names_are_nfc_normalised():
    decomposed = "Cafe\u0301 del Mar.mp3"
    cleaned = display_name(decomposed)
    assert cleaned == "Caf\u00e9 del Mar.mp3"
    assert unicodedata.is_normalized("NFC", cleaned)


def test_display_names_drop_folders_from_either_slash():
    assert display_name("Music/Albums/01 Intro.mp3") == "01 Intro.mp3"
    assert display_name("C:\\Users\\me\\Music\\02 Outro.mp3") == "02 Outro.mp3"


def test_display_names_collapse_whitespace_and_trim():
    assert display_name("  My \t  Song \n.mp3  ") == "My Song .mp3"


@pytest.mark.parametrize("empty", [None, "", "   ", "\x00\x01", ".", "..", "...", "a/", "\u202e"])
def test_empty_or_dot_only_names_become_untitled(empty):
    assert display_name(empty) == UNTITLED


@given(st.text(max_size=400))
def test_fuzz_display_names_are_always_safe_to_show(raw):
    cleaned = display_name(raw)
    assert 1 <= len(cleaned) <= MAX_DISPLAY_NAME
    assert unicodedata.is_normalized("NFC", cleaned)
    assert "/" not in cleaned and "\\" not in cleaned
    assert all(unicodedata.category(ch)[0] != "C" for ch in cleaned)
    assert cleaned == cleaned.strip()


def test_content_types_keep_real_mime_types_and_drop_the_rest():
    assert content_type("audio/mpeg") == "audio/mpeg"
    assert content_type("Audio/FLAC; charset=binary") == "audio/flac"
    assert content_type(None) == DEFAULT_CONTENT_TYPE
    assert content_type("") == DEFAULT_CONTENT_TYPE
    assert content_type("not a type") == DEFAULT_CONTENT_TYPE
    assert content_type("audio/mpeg\r\nX-Injected: 1") == DEFAULT_CONTENT_TYPE
    assert content_type("text/html<script>") == DEFAULT_CONTENT_TYPE


def test_browser_hashes_are_lower_cased_or_dropped():
    digest = "AB" * 32
    assert sha256_hex(digest) == "ab" * 32
    assert sha256_hex(f"  {digest} ") == "ab" * 32
    assert sha256_hex("zz" * 32) is None
    assert sha256_hex("ab" * 31) is None
    assert sha256_hex(None) is None


# -- the part policy --------------------------------------------------------------------------


def test_the_part_size_is_fixed_at_8_mib_within_r2s_limits():
    assert PART_SIZE == 8 * MiB
    assert MIN_PART_SIZE == 5 * MiB <= PART_SIZE <= 5 * GiB
    assert MAX_PARTS == 10_000


def test_a_one_gib_file_is_128_parts():
    plan = plan_parts(1 * GiB)
    assert (plan.part_size, plan.part_count, plan.last_part_size) == (PART_SIZE, 128, PART_SIZE)


@pytest.mark.parametrize("size", [1, 100, 5 * MiB, PART_SIZE - 1, PART_SIZE])
def test_a_file_no_bigger_than_one_part_is_a_single_part(size):
    plan = plan_parts(size)
    assert plan.part_count == 1
    assert plan.last_part_size == size


def test_the_last_part_holds_the_remainder():
    plan = plan_parts(PART_SIZE * 3 + 17)
    assert plan.part_count == 4
    assert plan.last_part_size == 17


def test_more_than_10000_parts_is_refused():
    assert plan_parts(PART_SIZE * MAX_PARTS).part_count == MAX_PARTS
    with pytest.raises(ValueError, match="10000 parts"):
        plan_parts(PART_SIZE * MAX_PARTS + 1)


def test_a_part_size_under_r2s_minimum_is_refused():
    with pytest.raises(ValueError, match="at least"):
        plan_parts(100, MIN_PART_SIZE - 1)
    assert plan_parts(MIN_PART_SIZE * 2, MIN_PART_SIZE).part_count == 2


@pytest.mark.parametrize("size", [0, -1])
def test_an_empty_upload_has_no_plan(size):
    with pytest.raises(ValueError, match="at least one byte"):
        plan_parts(size)


def test_accepted_files_stay_under_the_single_copy_limit():
    assert MAX_FILE_BYTES == 5 * GiB
    assert plan_parts(MAX_FILE_BYTES).part_count == 640


def _parts(*sizes: int) -> list[Part]:
    return [Part(number, f"etag-{number}", size) for number, size in enumerate(sizes, start=1)]


def test_parts_split_exactly_as_planned_pass():
    assert check_parts(_parts(PART_SIZE, PART_SIZE, 17), PART_SIZE * 2 + 17, PART_SIZE) is None
    assert check_parts(_parts(100), 100, PART_SIZE) is None
    assert check_parts(_parts(PART_SIZE), PART_SIZE, PART_SIZE) is None


def test_parts_listed_out_of_order_still_pass():
    parts = list(reversed(_parts(PART_SIZE, PART_SIZE, 5)))
    assert check_parts(parts, PART_SIZE * 2 + 5, PART_SIZE) is None


def test_no_parts_means_no_data_arrived():
    assert check_parts([], 100, PART_SIZE) == "No data arrived for this file."


@pytest.mark.parametrize(
    "numbers",
    [(1, 3), (2, 3), (1, 2, 4), (1, 1), (0, 1), (2,)],
    ids=["gap", "missing-first", "gap-later", "duplicate", "zero", "only-second"],
)
def test_a_missing_part_number_or_a_gap_is_refused(numbers):
    parts = [Part(n, "e", PART_SIZE) for n in numbers]
    assert check_parts(parts, PART_SIZE * len(numbers), PART_SIZE) == (
        "Some parts of the file are missing."
    )


def test_more_data_than_declared_is_refused():
    reason = check_parts(_parts(PART_SIZE, 18), PART_SIZE + 17, PART_SIZE)
    assert reason == "More data arrived than the file's declared size."


def test_less_data_than_declared_is_refused():
    reason = check_parts(_parts(PART_SIZE, 16), PART_SIZE + 17, PART_SIZE)
    assert reason == "Less data arrived than the file's declared size."
    assert check_parts(_parts(PART_SIZE), PART_SIZE + 17, PART_SIZE) == reason


def test_unequal_middle_parts_are_refused_even_when_the_total_matches():
    declared = PART_SIZE * 3
    parts = _parts(PART_SIZE, PART_SIZE - MiB, PART_SIZE + MiB)
    assert check_parts(parts, declared, PART_SIZE) == "The file's parts weren't the agreed size."


def test_equal_parts_of_the_wrong_size_are_refused():
    declared = 6 * MiB * 3
    parts = _parts(6 * MiB, 6 * MiB, 6 * MiB)
    assert check_parts(parts, declared, PART_SIZE) == "The file's parts weren't the agreed size."


def test_a_last_part_larger_than_the_others_is_refused_for_that_reason():
    declared = PART_SIZE * 2 + MiB
    parts = _parts(PART_SIZE, PART_SIZE + MiB)
    assert check_parts(parts, declared, PART_SIZE) == (
        "The file's last part wasn't the expected size."
    )


def test_more_parts_than_planned_with_the_right_total_is_refused():
    declared = PART_SIZE + 17
    parts = _parts(PART_SIZE - 100, 117)
    assert check_parts(parts, declared, PART_SIZE) == "The file's parts weren't the agreed size."
