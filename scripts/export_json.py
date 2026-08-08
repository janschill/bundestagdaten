"""Export the kommentar aggregates as static JSON for the website.

Reads data/protocols/*.xml, writes site/data/ — per-Wahlperiode aggregates in
wp<N>/, cross-period trends in trends.json, and a meta.json index. Everything
the site shows is precomputed here; the frontend does no aggregation.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from btd.frames import FRAKTIONEN_BY_WP, PARTY_COLORS, interaction_matrix, load_frames
from btd.parse_legacy import load_archive, modern_sitting_counts

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "protocols"
ARCHIVE_DIR = ROOT / "data" / "archives"
OUT_DIR = ROOT / "site" / "data"


def matrix_rows(matrix) -> list[list[float]]:
    return [[round(v, 2) for v in row] for row in matrix.to_numpy().tolist()]


def quarterly_series(speeches: pd.DataFrame, events: pd.DataFrame) -> dict:
    """Quarterly rates: weighted events per speech and the cross-fraktion
    applause share (within attributed applause; government speeches carry a
    role instead of a fraktion and are excluded from the share)."""
    fraktionen = {p for parties in FRAKTIONEN_BY_WP.values() for p in parties}
    quarter = lambda df: df["date"].dt.to_period("Q")  # noqa: E731

    reden = speeches.groupby(quarter(speeches)).size()
    by_kind = {
        kind: events[events["kind"].isin(kinds)].groupby(quarter(events))["weight"].sum().reindex(reden.index, fill_value=0.0)
        for kind, kinds in {
            "beifall": ["beifall"],
            "zurufe": ["zuruf"],
            "lachen": ["lachen", "heiterkeit"],
        }.items()
    }

    attributed = events[
        (events["kind"] == "beifall") & events["party"].isin(fraktionen) & events["to_party"].isin(fraktionen)
    ]
    total = attributed.groupby(quarter(attributed))["weight"].sum().reindex(reden.index, fill_value=0.0)
    fremd = attributed[attributed["party"] != attributed["to_party"]]
    fremd_sum = fremd.groupby(quarter(fremd))["weight"].sum().reindex(reden.index, fill_value=0.0)

    return {
        "quartale": [str(q) for q in reden.index],
        "reden": [int(n) for n in reden],
        "beifall_fremd_anteil": [round(f / t, 3) if t else None for f, t in zip(fremd_sum, total)],
        "beifall_pro_rede": [round(v / n, 2) for v, n in zip(by_kind["beifall"], reden)],
        "zurufe_pro_rede": [round(v / n, 2) for v, n in zip(by_kind["zurufe"], reden)],
        "lachen_pro_rede": [round(v / n, 2) for v, n in zip(by_kind["lachen"], reden)],
    }


def export_wahlperiode(wp: int, speeches: pd.DataFrame, events: pd.DataFrame) -> dict:
    fraktionen = FRAKTIONEN_BY_WP[wp]
    out = OUT_DIR / f"wp{wp}"

    write(out / "matrices.json", {
        "fraktionen": fraktionen,
        "colors": {p: PARTY_COLORS[p] for p in fraktionen},
        # rows: party of the speaker on the lectern, cols: fraktion reacting;
        # values: weighted events per speech held (see interaction_matrix)
        "beifall": matrix_rows(interaction_matrix(events, speeches, "beifall", fraktionen)),
        "zuruf": matrix_rows(interaction_matrix(events, speeches, "zuruf", fraktionen)),
    })

    per_speaker = (
        events[events["kind"] == "beifall"]
        .groupby(["to_speaker", "to_party"], as_index=False)["weight"].sum()
        .merge(
            speeches.groupby(["speaker", "party"]).size().rename("n_reden").reset_index(),
            left_on=["to_speaker", "to_party"], right_on=["speaker", "party"],
        )
    )
    per_speaker = per_speaker[per_speaker["n_reden"] >= 10]
    per_speaker["rate"] = per_speaker["weight"] / per_speaker["n_reden"]
    top_beifall = per_speaker.nlargest(15, "rate")

    named = events[(events["kind"] == "zuruf") & (events["person"] != "")]
    top_zuruf = named.groupby(["person", "party"]).size().rename("n").reset_index().nlargest(15, "n")

    write(out / "speakers.json", {
        "beifall": [
            {"speaker": r.to_speaker, "party": r.to_party, "rate": round(r.rate, 1), "n_reden": int(r.n_reden)}
            for r in top_beifall.itertuples()
        ],
        "zurufe": [
            {"person": r.person, "party": r.party, "n": int(r.n)}
            for r in top_zuruf.itertuples()
        ],
    })

    received = events[
        (events["kind"] == "beifall")
        & events["party"].isin(fraktionen)
        & events["to_party"].isin(fraktionen)
    ]
    totals = received.groupby("to_party")["weight"].sum()
    own = received[received["party"] == received["to_party"]].groupby("to_party")["weight"].sum()
    share = (own / totals).reindex(fraktionen).dropna()
    write(out / "selbstapplaus.json", [
        {"party": party, "share": round(value, 3)}
        for party, value in share.sort_values(ascending=False).items()
    ])

    quotes = events[events["quote"] != ""].dropna(subset=["date"])
    frequent = quotes["quote"].value_counts().head(12)
    recent = quotes.sort_values("date").tail(20).iloc[::-1]
    write(out / "zitate.json", {
        "gesamt": int(len(quotes)),
        "jahre": sorted(quotes["date"].dt.year.unique().tolist()),
        "haeufig": [{"quote": quote, "n": int(n)} for quote, n in frequent.items()],
        "zuletzt": [
            {
                "quote": r.quote, "person": r.person, "party": r.party,
                "to_speaker": r.to_speaker, "to_party": r.to_party,
                "date": r.date.strftime("%Y-%m-%d"),
            }
            for r in recent.itertuples()
        ],
    })

    # drill-down page data: within-WP timeline, full person lists, the whole
    # quote archive (one file per year, fetched on demand), per-sitting stats
    write(out / "verlauf.json", quarterly_series(speeches, events))

    all_speakers = (
        events[events["kind"] == "beifall"]
        .groupby(["to_speaker", "to_party"], as_index=False)["weight"].sum()
        .merge(
            speeches.groupby(["speaker", "party"]).size().rename("n_reden").reset_index(),
            left_on=["to_speaker", "to_party"], right_on=["speaker", "party"], how="right",
        )
        .fillna({"weight": 0.0})
    )
    all_speakers = all_speakers[all_speakers["n_reden"] >= 5]
    all_speakers["rate"] = all_speakers["weight"] / all_speakers["n_reden"]
    write(out / "personen.json", {
        "redner": [
            {"name": r.speaker, "party": r.party, "reden": int(r.n_reden), "rate": round(r.rate, 1)}
            for r in all_speakers.sort_values("rate", ascending=False).itertuples()
        ],
        "zwischenrufer": [
            {"person": r.person, "party": r.party, "n": int(r.n)}
            for r in named.groupby(["person", "party"]).size().rename("n").reset_index()
            .sort_values("n", ascending=False).itertuples()
        ],
    })

    # compact rows [quote, person, party, to_speaker, date] — these files are
    # large (thousands of quotes per year), so no repeated object keys
    for year, group in quotes.groupby(quotes["date"].dt.year):
        chronological = group.sort_values("date", ascending=False)
        write(out / f"zitate-{year}.json", [
            [r.quote, r.person, r.party, r.to_speaker, r.date.strftime("%Y-%m-%d")]
            for r in chronological.itertuples()
        ])

    per_sitting = speeches.groupby(["sitzung", "date"]).size().rename("reden").reset_index()
    kind_counts = {
        kind: events[events["kind"].isin(kinds)].groupby("sitzung")["weight"].sum()
        for kind, kinds in {"beifall": ["beifall"], "zurufe": ["zuruf"], "lachen": ["lachen", "heiterkeit"]}.items()
    }
    write(out / "sitzungen.json", [
        {
            "nr": int(r.sitzung),
            "datum": r.date.strftime("%Y-%m-%d"),
            "reden": int(r.reden),
            **{kind: int(kind_counts[kind].get(r.sitzung, 0)) for kind in kind_counts},
        }
        for r in per_sitting.sort_values("sitzung").itertuples()
    ])

    return {
        "wp": wp,
        "sitzungen": int(speeches["sitzung"].nunique()),
        "reden": int(len(speeches)),
        "ereignisse": int(len(events)),
        "von": speeches["date"].min().strftime("%Y-%m-%d"),
        "bis": speeches["date"].max().strftime("%Y-%m-%d"),
    }


def export_trends(speeches: pd.DataFrame, events: pd.DataFrame) -> None:
    """Quarterly series across all Wahlperioden."""
    write(OUT_DIR / "trends.json", quarterly_series(speeches, events) | {
        "wp_marken": [
            {"wp": int(wp), "von": group["date"].min().strftime("%Y-%m-%d")}
            for wp, group in speeches.groupby("wahlperiode")
        ],
    })


def export_history() -> None:
    """Yearly kind counts per 10,000 words, 1949 to today, across both formats.

    Counted once per kommentar segment (see btd.parse_legacy), so the
    unattributed early decades and the structured present are comparable.
    """
    sittings = [s for zip_path in sorted(ARCHIVE_DIR.glob("pp*.zip")) for s in load_archive(zip_path)]
    sittings += [modern_sitting_counts(path) for path in sorted(DATA_DIR.glob("*.xml"))]
    if not sittings:
        return
    frame = pd.DataFrame(
        {
            "year": int(s.date[-4:]),
            "words": s.words,
            "beifall": s.counts["beifall"],
            "zurufe": s.counts["zuruf"],
            "lachen": s.counts["lachen"] + s.counts["heiterkeit"],
        }
        for s in sittings
    )
    yearly = frame.groupby("year").sum()
    yearly["sitzungen"] = frame.groupby("year").size()
    per10k = lambda kind: [round(v / w * 10_000, 2) for v, w in zip(yearly[kind], yearly["words"])]  # noqa: E731

    write(OUT_DIR / "seit1949.json", {
        "jahre": [int(y) for y in yearly.index],
        "sitzungen": [int(n) for n in yearly["sitzungen"]],
        "beifall": per10k("beifall"),
        "zurufe": per10k("zurufe"),
        "lachen": per10k("lachen"),
    })


def export_pages(wahlperioden: list[int]) -> None:
    """Stamp out the drill-down page per Wahlperiode from the template."""
    template = (ROOT / "site" / "wp" / "template.html").read_text(encoding="utf-8")
    for wp in wahlperioden:
        page = ROOT / "site" / "wp" / str(wp) / "index.html"
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text(template.replace("{{WP}}", str(wp)), encoding="utf-8")
        print(f"wrote {page.relative_to(ROOT)}")


def export() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    present = sorted({int(path.name[:2]) for path in DATA_DIR.glob("*.xml")})
    export_pages(present)

    wahlperioden = []
    all_speeches, all_events = [], []
    for wp in present:
        speeches, events = load_frames(DATA_DIR, wp)
        wahlperioden.append(export_wahlperiode(wp, speeches, events))
        all_speeches.append(speeches)
        all_events.append(events)

    export_trends(pd.concat(all_speeches, ignore_index=True), pd.concat(all_events, ignore_index=True))
    export_history()

    write(OUT_DIR / "meta.json", {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "wahlperioden": wahlperioden,
    })


def write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    export()
