"""Export the kommentar aggregates as static JSON for the website.

Reads data/protocols/*.xml, writes site/data/*.json — everything the site
shows is precomputed here; the frontend does no aggregation.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from btd.frames import FRAKTIONEN, PARTY_COLORS, interaction_matrix, load_frames

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "site" / "data"


def matrix_rows(matrix) -> list[list[float]]:
    return [[round(v, 2) for v in row] for row in matrix.to_numpy().tolist()]


def export(wahlperiode: int = 21) -> None:
    speeches, events = load_frames(ROOT / "data" / "protocols", wahlperiode)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    write("matrices.json", {
        "fraktionen": FRAKTIONEN,
        "colors": PARTY_COLORS,
        # rows: party of the speaker on the lectern, cols: fraktion reacting;
        # values: weighted events per speech held (see interaction_matrix)
        "beifall": matrix_rows(interaction_matrix(events, speeches, "beifall")),
        "zuruf": matrix_rows(interaction_matrix(events, speeches, "zuruf")),
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

    write("speakers.json", {
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
        & events["party"].isin(FRAKTIONEN)
        & events["to_party"].isin(FRAKTIONEN)
    ]
    totals = received.groupby("to_party")["weight"].sum()
    own = received[received["party"] == received["to_party"]].groupby("to_party")["weight"].sum()
    share = (own / totals).reindex(FRAKTIONEN)
    write("selbstapplaus.json", [
        {"party": party, "share": round(value, 3)}
        for party, value in share.sort_values(ascending=False).items()
    ])

    quotes = events[events["quote"] != ""]
    frequent = quotes["quote"].value_counts().head(12)
    recent = quotes.dropna(subset=["date"]).sort_values("date").tail(20).iloc[::-1]
    write("zitate.json", {
        "gesamt": int(len(quotes)),
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

    write("meta.json", {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "wahlperiode": wahlperiode,
        "sitzungen": int(speeches["sitzung"].nunique()),
        "reden": int(len(speeches)),
        "ereignisse": int(len(events)),
        "von": speeches["date"].min().strftime("%Y-%m-%d"),
        "bis": speeches["date"].max().strftime("%Y-%m-%d"),
    })


def write(name: str, payload) -> None:
    path = OUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    export()
