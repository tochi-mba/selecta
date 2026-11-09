"""Room codes, pairing codes and guest tokens: the secrets Rooms hand out, and how they're kept.

A room code is eight characters from an alphabet with nothing easily misread (no 0/O, 1/I/L, U),
about 39 bits, shown as `K7QD-M2XP`. People type them however they like, so input is uppercased
and spaces and dashes are dropped; anything outside the alphabet is refused.

The database never holds a code. It holds an HMAC-SHA256 of the code keyed by a server pepper,
which is how a join finds its room, and a random seed. The room's code is worked out from the seed
and the pepper whenever the host's panel or a paired display needs to show it, so a copy of the
database alone gives away no codes. (With the pepper too, 39 bits is searchable anyway; the seed
adds nothing an attacker with the pepper couldn't get from the hash.)

Guest and display tokens are long random strings; only their SHA-256 is stored.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8
PAIRING_CODE_LENGTH = 6
REUSE_BLOCK_DAYS = 30  # a closed room's code isn't given to another room for this long
MIN_PEPPER_BYTES = 16

_ALLOWED = frozenset(ALPHABET)
_SEPARATORS = re.compile(r"[\s\-‐-―]+")
_UNBIASED_BELOW = 256 - 256 % len(ALPHABET)  # 240: bytes at or above it would favour some chars


class InvalidCode(ValueError):
    """Not a code Selecta could have given out."""


def check_pepper(pepper: bytes) -> bytes:
    if not isinstance(pepper, bytes) or len(pepper) < MIN_PEPPER_BYTES:
        raise ValueError(f"The rooms pepper must be at least {MIN_PEPPER_BYTES} bytes")
    return pepper


def generate(length: int = CODE_LENGTH) -> str:
    """A fresh random code from the alphabet."""
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def new_seed() -> str:
    return secrets.token_hex(16)


def derive(seed: str, pepper: bytes, length: int = CODE_LENGTH) -> str:
    """The code a room's seed stands for. Same seed and pepper, same code; uniform over the
    alphabet because biased bytes are skipped rather than wrapped round."""
    chars: list[str] = []
    counter = 0
    while len(chars) < length:
        block = hmac.new(
            pepper, f"selecta.room-code.v1:{seed}:{counter}".encode(), hashlib.sha256
        ).digest()
        for byte in block:
            if byte < _UNBIASED_BELOW:
                chars.append(ALPHABET[byte % len(ALPHABET)])
                if len(chars) == length:
                    break
        counter += 1
    return "".join(chars)


def display(code: str) -> str:
    """`K7QDM2XP` as `K7QD-M2XP`; a six-character pairing code as `K7Q-DM2`."""
    half = len(code) // 2
    return f"{code[:half]}-{code[half:]}"


def normalise(text: str, length: int = CODE_LENGTH) -> str:
    """What someone typed, as the code it must be: uppercase, no spaces or dashes."""
    code = _SEPARATORS.sub("", text or "").upper()
    if len(code) != length or not set(code) <= _ALLOWED:
        raise InvalidCode("That isn't a valid code")
    return code


def code_hash(code: str, pepper: bytes) -> str:
    """How a room code is stored and looked up."""
    return _keyed(pepper, "room-code", normalise(code, CODE_LENGTH))


def pairing_hash(code: str, pepper: bytes) -> str:
    """How a display's pairing code is stored and looked up."""
    return _keyed(pepper, "pairing-code", normalise(code, PAIRING_CODE_LENGTH))


def new_token() -> str:
    """A guest or display token: 256 random bits, URL-safe."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_ip(ip: str, pepper: bytes) -> str:
    """A guest's IP as it's kept: keyed, so the stored value can't be reversed by trying every
    address without the pepper."""
    return _keyed(pepper, "ip", ip.strip())


def _keyed(pepper: bytes, purpose: str, text: str) -> str:
    return hmac.new(pepper, f"{purpose}:{text}".encode(), hashlib.sha256).hexdigest()
