"""Generated guest nicknames, like "Blue Fox". There's no free text anywhere in Rooms, so a guest
can only ever be called something from these lists.

The words are chosen to be harmless in any pairing: colours, weather and cheerful moods, and
animals that aren't used as insults.
"""

from __future__ import annotations

import secrets
from collections.abc import Collection

ADJECTIVES = (
    "Amber", "Azure", "Blue", "Brave", "Breezy", "Bright", "Calm", "Cheerful", "Clever", "Coral",
    "Cosmic", "Crimson", "Daring", "Dreamy", "Eager", "Electric", "Emerald", "Gentle", "Golden",
    "Green", "Happy", "Indigo", "Jolly", "Lively", "Lucky", "Lunar", "Mellow", "Merry", "Misty",
    "Nimble", "Plucky", "Quiet", "Rapid", "Scarlet", "Silver", "Sleepy", "Snowy", "Starry",
    "Sunny", "Swift", "Teal", "Velvet", "Violet", "Witty", "Zesty",
)  # fmt: skip

ANIMALS = (
    "Badger", "Bear", "Beaver", "Bison", "Crane", "Dolphin", "Eagle", "Falcon", "Finch", "Fox",
    "Gecko", "Hedgehog", "Heron", "Kingfisher", "Koala", "Lark", "Lemur", "Lion", "Llama",
    "Lynx", "Moose", "Narwhal", "Newt", "Octopus", "Otter", "Owl", "Panda", "Parrot", "Penguin",
    "Puffin", "Quail", "Rabbit", "Raven", "Robin", "Seal", "Sparrow", "Squirrel", "Swan",
    "Tiger", "Toucan", "Turtle", "Walrus", "Wombat", "Wren", "Zebra",
)  # fmt: skip

_ADJECTIVES = frozenset(ADJECTIVES)
_ANIMALS = frozenset(ANIMALS)


def generate() -> str:
    return f"{secrets.choice(ADJECTIVES)} {secrets.choice(ANIMALS)}"


def is_generated(name: str) -> bool:
    """Is this one of ours? A guest choosing a nickname can only choose one of these."""
    parts = (name or "").split(" ")
    return len(parts) == 2 and parts[0] in _ADJECTIVES and parts[1] in _ANIMALS


def unique(taken: Collection[str], attempts: int = 40) -> str:
    """A nickname nobody in the room has yet. Two thousand pairs are plenty for a hundred guests;
    if luck runs out, a number keeps it unique ("Blue Fox 2")."""
    for _ in range(attempts):
        name = generate()
        if name not in taken:
            return name
    base = generate()
    number = 2
    while f"{base} {number}" in taken:
        number += 1
    return f"{base} {number}"


def choices(count: int = 6, taken: Collection[str] = ()) -> list[str]:
    """A handful of nicknames to pick from, none already in use."""
    picked: list[str] = []
    for _ in range(count * 20):
        name = generate()
        if name not in taken and name not in picked:
            picked.append(name)
            if len(picked) == count:
                break
    return picked
