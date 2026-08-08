"""Parse Bundestag plenary protocol XMLs (dbtplenarprotokoll DTD).

Extracts speeches and structured "kommentar" events (Beifall, Zurufe, Lachen, ...).
A kommentar like "(Beifall bei der SPD sowie bei Abgeordneten der CDU/CSU – Lachen
bei der AfD)" becomes multiple events, each attributed to the parties (or named
member) it came from and to the speech it interrupted.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from lxml import etree

# pattern → canonical short name; declined forms included (des BÜNDNISSES, der Linken)
PARTY_PATTERNS = [
    (re.compile(r"CDU/CSU"), "CDU/CSU"),
    (re.compile(r"\bSPD\b"), "SPD"),
    (re.compile(r"\bAfD\b"), "AfD"),
    (re.compile(r"BÜNDNIS(?:SES)? 90/DIE GRÜNEN|\bGrünen\b"), "Grüne"),
    (re.compile(r"\b(?:Die |DIE )?(?:Linken?|LINKEN?)\b"), "Linke"),
    (re.compile(r"\bFDP\b"), "FDP"),
    (re.compile(r"\bBSW\b"), "BSW"),
    (re.compile(r"\bfraktionslos\w*\b"), "fraktionslos"),
]


def canonical_party(name: str) -> str:
    name = name.replace("\xa0", " ").strip()
    for pattern, canonical in PARTY_PATTERNS:
        if pattern.search(name):
            return canonical
    return name


EVENT_WORDS = {
    "Beifall": "beifall",
    "Zuruf": "zuruf",
    "Zurufe": "zuruf",
    "Lachen": "lachen",
    "Heiterkeit": "heiterkeit",
    "Widerspruch": "widerspruch",
}
# "Lebhafter Beifall", "Erneuter Beifall", "Anhaltender Beifall", ...
MODIFIERS = {"Lebhafter", "Anhaltender", "Erneuter", "Langanhaltender", "Demonstrativer"}

# "Stephan Brandner [AfD]: Skandal!" — a named, quoted interjection;
# an optional first bracket holds the constituency: "Claudia Roth [Augsburg] [BÜNDNIS 90/DIE GRÜNEN]: ..."
QUOTED_RE = re.compile(
    r"^(?P<name>[^:\[\]]+?)\s*(?:\[[^\]]+\]\s*)?\[(?P<party>[^\]]+)\]\s*:\s*(?P<quote>.+)$", re.DOTALL
)
# named source without quote: "Zuruf des Abg. Mahmut Özdemir [Duisburg] [SPD]"
NAMED_RE = re.compile(r"Abg\.\s+([^\[\]]+?)\s*(?:\[[^\]]+\]\s*)?\[([^\]]+)\](?!\s*\[)")


@dataclass
class Speech:
    rede_id: str
    sitzung: int
    wahlperiode: int
    date: str
    top: str
    speaker_id: str
    speaker: str
    party: str  # fraktion, or rolle for government members
    is_government: bool
    words: int  # spoken words, excluding kommentar text


@dataclass
class KommentarEvent:
    rede_id: str
    kind: str  # beifall | zuruf | lachen | heiterkeit | widerspruch
    party: str  # who it came from ("" if unknown)
    person: str  # named member, if attributed to one
    partial: bool  # "bei Abgeordneten der X" (some members) vs the whole fraktion
    quote: str  # verbatim text for quoted zurufe
    raw: str  # the segment as printed


def _find_parties(segment: str) -> list[tuple[str, bool]]:
    """Return (party, partial) pairs mentioned as sources in a segment.

    "bei Abgeordneten der SPD" marks partial applause (some members); a bare
    "bei der SPD" means the whole fraktion. The last "Abgeordneten der/des"
    before the party name decides which, and it distributes across an
    "und"-joined list ("bei Abgeordneten der SPD und der CDU/CSU").
    """
    results = []
    seen = set()
    for pattern, canonical in PARTY_PATTERNS:
        m = pattern.search(segment)
        if not m or canonical in seen:
            continue
        seen.add(canonical)
        before = segment[: m.start()]
        anchors = [
            (pos.start(), word)
            for word in ("Abgeordneten", "bei der", "beim", "bei den", "der Fraktion")
            for pos in re.finditer(word, before)
        ]
        partial = bool(anchors) and max(anchors)[1] == "Abgeordneten"
        results.append((canonical, partial))
    return results


def parse_kommentar(text: str, rede_id: str) -> list[KommentarEvent]:
    text = text.replace("\xa0", " ").strip()
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1]
    events = []
    for segment in re.split(r"\s+–\s+", text):
        segment = segment.strip()
        if not segment:
            continue
        words = segment.split()
        first = words[1] if words[0] in MODIFIERS and len(words) > 1 else words[0]
        kind = EVENT_WORDS.get(first.rstrip(":,"))
        quoted = QUOTED_RE.match(segment) if kind is None else None
        if quoted:
            events.append(
                KommentarEvent(
                    rede_id=rede_id,
                    kind="zuruf",
                    party=canonical_party(quoted.group("party")),
                    person=quoted.group("name").strip(),
                    partial=True,
                    quote=quoted.group("quote").strip(),
                    raw=segment,
                )
            )
            continue
        if kind is None:
            events.append(KommentarEvent(rede_id, "other", "", "", False, "", segment))
            continue
        # named member as source, e.g. "Zuruf des Abg. Bernd Baumann [AfD]"
        named = NAMED_RE.search(segment)
        named_party = canonical_party(named.group(2)) if named else ""
        if named:
            events.append(
                KommentarEvent(
                    rede_id=rede_id,
                    kind=kind,
                    party=named_party,
                    person=named.group(1).strip(),
                    partial=True,
                    quote="",
                    raw=segment,
                )
            )
        # fraktion-level sources; drop the named member's party only when it
        # appears solely inside their bracket attribution
        parties = _find_parties(re.sub(NAMED_RE, "", segment)) if named else _find_parties(segment)
        if not parties and not named:
            events.append(KommentarEvent(rede_id, kind, "", "", False, "", segment))
        for party, partial in parties:
            events.append(KommentarEvent(rede_id, kind, party, "", partial, "", segment))
    return events


def _word_count(rede) -> int:
    """Spoken words of a rede, excluding the kommentar interjections.

    Rates per 1,000 words correct for unequal speaking time (bigger fraktionen
    get longer slots), following Küpfer/Müller/Stecker 2025.
    """
    total = len(" ".join(rede.itertext()).split())
    kommentare = sum(len(k.text.split()) for k in rede.iter("kommentar") if k.text)
    return total - kommentare


def _dedouble(text: str) -> str:
    """Fix a Bundestag XML data bug where text nodes are duplicated ("SPDSPD")."""
    half = len(text) // 2
    if text and len(text) % 2 == 0 and text[:half] == text[half:]:
        return text[:half]
    return text


def parse_protocol(path: Path) -> tuple[list[Speech], list[KommentarEvent]]:
    tree = etree.parse(str(path))
    root = tree.getroot()
    sitzung = int(root.get("sitzung-nr"))
    wahlperiode = int(root.get("wahlperiode"))
    date = root.get("sitzung-datum")

    speeches: list[Speech] = []
    events: list[KommentarEvent] = []
    for rede in root.iter("rede"):
        redner = rede.find(".//redner")
        if redner is None:
            continue
        name_el = redner.find("name")
        vorname = _dedouble(name_el.findtext("vorname", "")) if name_el is not None else ""
        nachname = _dedouble(name_el.findtext("nachname", "")) if name_el is not None else ""
        fraktion = _dedouble(name_el.findtext("fraktion", "")) if name_el is not None else ""
        rolle = name_el.findtext("rolle/rolle_kurz", "") if name_el is not None else ""
        top_el = rede.getparent()
        speeches.append(
            Speech(
                rede_id=rede.get("id"),
                sitzung=sitzung,
                wahlperiode=wahlperiode,
                date=date,
                top=top_el.get("top-id", "") if top_el is not None else "",
                speaker_id=redner.get("id", ""),
                speaker=f"{vorname} {nachname}".strip(),
                party=canonical_party(fraktion) if fraktion else rolle,
                is_government=bool(rolle and not fraktion),
                words=_word_count(rede),
            )
        )
        for kommentar in rede.iter("kommentar"):
            if kommentar.text:
                events.extend(parse_kommentar(kommentar.text, rede.get("id")))
    return speeches, events


def load_term(data_dir: Path, wahlperiode: int = 21) -> tuple[list[Speech], list[KommentarEvent]]:
    """Parse every downloaded protocol of one electoral term."""
    speeches: list[Speech] = []
    events: list[KommentarEvent] = []
    for path in sorted(data_dir.glob(f"{wahlperiode}*.xml")):
        s, e = parse_protocol(path)
        speeches.extend(s)
        events.extend(e)
    return speeches, events
