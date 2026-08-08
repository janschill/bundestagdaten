"""Count kommentar events in the pre-WP19 plain-text protocols (pp01…pp18.zip).

The historical XMLs carry the whole protocol as one text blob — no speech
structure, and early terms attribute applause by seating direction rather
than fraktion. What is reliable across all eras: parenthesized interjections
("(Beifall bei der SPD ...)", "(Zurufe rechts)") and the amount of spoken
text. So this module yields per-sitting event counts by kind plus a word
count for normalization; party attribution stays out of scope.

Unlike btd.parse (which emits one event per attributed source), counting here
is once per segment, so eras with and without attribution stay comparable.
"""

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from lxml import etree

from btd.parse import EVENT_WORDS

# a parenthesized stretch (may span lines) mentioning an interjection keyword
KOMMENTAR_RE = re.compile(r"\((?=[^()]*(?:Beifall|Zuruf|Lachen|Heiterkeit))([^()]*)\)", re.DOTALL)
# segments are separated by dashes; the dash flavor varies across the decades
DASH_SPLIT = re.compile(r"\s+[–—-]\s+")
COUNTED_KINDS = ("beifall", "zuruf", "lachen", "heiterkeit")


def segment_kinds(text: str) -> list[str]:
    """Classify each dash-separated segment of a kommentar, one kind per segment.

    The keyword may follow era-specific modifiers ("Stürmischer Beifall",
    "Erneuter lebhafter Beifall"), so the first few words are searched instead
    of enumerating modifiers.
    """
    kinds = []
    for segment in DASH_SPLIT.split(text.replace("\xa0", " ")):
        words = segment.split()
        kind = next(
            (EVENT_WORDS[w.rstrip(":,.")] for w in words[:3] if w.rstrip(":,.") in EVENT_WORDS),
            None,
        )
        if kind in COUNTED_KINDS:
            kinds.append(kind)
    return kinds


@dataclass
class SittingCounts:
    wahlperiode: int
    sitzung: int
    date: str  # DD.MM.YYYY, as printed in the protocol
    words: int
    counts: dict[str, int]  # kind -> segments


def parse_legacy_protocol(xml_bytes: bytes) -> SittingCounts:
    root = etree.fromstring(xml_bytes)
    text = root.findtext("TEXT", "")
    counts = dict.fromkeys(COUNTED_KINDS, 0)
    for match in KOMMENTAR_RE.finditer(text):
        for kind in segment_kinds(match.group(1)):
            counts[kind] += 1
    wahlperiode, sitzung = root.findtext("NR", "0/0").split("/")
    return SittingCounts(
        wahlperiode=int(wahlperiode),
        sitzung=int(sitzung),
        date=root.findtext("DATUM", ""),
        words=len(text.split()),
        counts=counts,
    )


def load_archive(zip_path: Path) -> list[SittingCounts]:
    """Parse every protocol inside one pp<NN>.zip."""
    sittings = []
    with zipfile.ZipFile(zip_path) as archive:
        for name in sorted(archive.namelist()):
            if name.endswith(".xml"):
                sittings.append(parse_legacy_protocol(archive.read(name)))
    return sittings


def modern_sitting_counts(path: Path) -> SittingCounts:
    """The same counting applied to a structured WP19+ protocol XML."""
    root = etree.parse(str(path)).getroot()
    counts = dict.fromkeys(COUNTED_KINDS, 0)
    for kommentar in root.iter("kommentar"):
        text = (kommentar.text or "").strip()
        for kind in segment_kinds(text.removeprefix("(").removesuffix(")")):
            counts[kind] += 1
    words = len(" ".join(root.itertext()).split())
    return SittingCounts(
        wahlperiode=int(root.get("wahlperiode")),
        sitzung=int(root.get("sitzung-nr")),
        date=root.get("sitzung-datum"),
        words=words,
        counts=counts,
    )
