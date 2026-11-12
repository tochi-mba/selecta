"""The sittings of the owner verification runbook: what each one covers and its script.

Order matters: a task goes to the first sitting whose words match its title and "Needs a person"
text, so the narrow sittings (legal, staging, screen reader, devices, listening) come before the
broad ones (study, visual review), and the sign-off pass catches everything else. OVERRIDES
pins a task to a sitting when the words mislead.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Sitting:
    number: int
    slug: str
    name: str
    words: tuple[str, ...]
    summary: str
    prepare: tuple[str, ...]
    steps: tuple[str, ...]
    passes: str
    record: str


INTRO = """
# Owner verification runbook
"""

OUTRO = """
"""

SITTINGS: tuple[Sitting, ...] = (
    Sitting(
        1,
        "legal-business",
        "Legal and business list",
        (
            r"legal",
            r"licen[cs]",
            r"privacy (policy|notice)",
            r"terms",
            r"gdpr",
            r"paid",
            r"billing",
            r"pricing",
            r"trademark",
            r"copyright",
            r"subprocessor",
            r"dpa",
            r"payment",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(
        2,
        "staging",
        "Staging and cloud list",
        (
            r"staging",
            r"deploy",
            r"production",
            r"postgres",
            r"docker",
            r"cloud",
            r"hosted",
            r"real (server|account)",
            r"tls",
            r"backup",
            r"restore drill",
            r"incident",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(
        3,
        "screen-reader",
        "Screen-reader session",
        (
            r"nvda",
            r"voiceover",
            r"narrator",
            r"screen[- ]reader",
            r"jaws",
            r"talkback",
            r"assistive",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(
        4,
        "devices",
        "Phone, touch and hardware session",
        (
            r"phones?",
            r"touch",
            r"ios",
            r"android",
            r"safari",
            r"mobile",
            r"tablet",
            r"real (device|hardware)",
            r"profil(er|e)",
            r"devices?",
            r"zoom",
            r"reduced motion",
            r"high contrast",
            r"forced colou?rs",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(
        5,
        "listening",
        "Listening session",
        (
            r"listen",
            r"audib",
            r"by ear",
            r"real audio",
            r"captured audio",
            r"sound",
            r"reels?",
            r"mix(es)? sound",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(
        6,
        "user-study",
        "User-study sessions",
        (
            r"stud(y|ies)",
            r"participant",
            r"uncoached",
            r"five[- ]second",
            r"novice",
            r"walkthrough",
            r"interview",
            r"usability",
            r"glance test",
            r"users? test",
            r"observation",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(
        7,
        "visual-review",
        "Visual review and baseline approval",
        (
            r"baseline",
            r"screenshot",
            r"specimen",
            r"visual",
            r"design (critique|review)",
            r"contrast",
            r"captures?",
            r"theme",
        ),
        "",
        (),
        (),
        "",
        "",
    ),
    Sitting(8, "sign-off", "Sign-off pass", (r".",), "", (), (), "", ""),
)

# task ID -> sitting slug, for tasks whose words would file them in the wrong sitting
OVERRIDES: dict[str, str] = {}
