"""Generated guest nicknames, like "Blue Fox". There's no free text anywhere in Rooms, so a guest
can only ever be called something from these lists.

The words are chosen to be harmless in any pairing: colours, weather and cheerful moods, and
animals that aren't used as insults.
"""

from __future__ import annotations

import secrets
from collections.abc import Collection

ADJECTIVES = (
    "Adorable", "Agile", "Amber", "Azure", "Beaming", "Blissful", "Blue",
    "Bold", "Bouncy", "Brave", "Breezy", "Bright", "Bubbly", "Calm",
    "Charming", "Cheerful", "Clever", "Coral", "Cosmic", "Cozy", "Creative",
    "Curious", "Daring", "Dazzling", "Dreamy", "Eager", "Elegant",
    "Emerald", "Enchanting", "Energetic", "Fancy", "Fluffy", "Friendly",
    "Frosty", "Gentle", "Glowing", "Golden", "Graceful", "Green",
    "Happy", "Indigo", "Jolly", "Joyful", "Kind", "Lively", "Lucky",
    "Lunar", "Magical", "Majestic", "Mellow", "Merry", "Misty",
    "Nimble", "Noble", "Peaceful", "Playful", "Plucky", "Quiet",
    "Radiant", "Rapid", "Rosy", "Royal", "Scarlet", "Serene",
    "Shimmering", "Silver", "Sleepy", "Snowy", "Sparkly", "Starry",
    "Sunny", "Swift", "Teal", "Velvet", "Vibrant", "Violet",
    "Whimsical", "Witty", "Zesty",
)  # fmt: skip

ANIMALS = (
    "Alpaca", "Axolotl", "Badger", "Bear", "Bee",
    "Bison", "Bluebird", "Bumblebee", "Butterfly", "Camel",
    "Canary", "Capybara", "Cat", "Chameleon", "Chipmunk",
    "Crane", "Deer", "Dolphin", "Dove", "Dragonfly", "Duck",
    "Eagle", "Elephant", "Falcon", "Fawn", "Ferret", "Finch",
    "Firefly", "Flamingo", "Fox", "Frog", "Gazelle", "Gecko",
    "Giraffe", "Hamster", "Hare", "Hedgehog", "Heron",
    "Hummingbird", "Jaguar", "Kangaroo", "Kingfisher",
    "Koala", "Lark", "Lemur", "Lion", "Llama", "Lynx",
    "Meerkat", "Moose", "Narwhal", "Newt", "Octopus",
    "Otter", "Owl", "Panda", "Parrot", "Peacock", "Penguin",
    "Puffin", "Quail", "Quokka", "Rabbit", "Raven", "Robin",
    "Seal", "Sparrow", "Squirrel", "Swan", "Tiger", "Toucan",
    "Turtle", "Walrus", "Wombat", "Wren", "Zebra",
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
