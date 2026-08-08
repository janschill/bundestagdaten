"""Turn parsed protocols into analysis-ready pandas DataFrames."""

from pathlib import Path

import pandas as pd

from btd.parse import load_term

# canonical display order, filtered per Wahlperiode so matrices stay comparable
FRAKTIONEN_BY_WP = {
    19: ["CDU/CSU", "SPD", "AfD", "FDP", "Grüne", "Linke"],
    20: ["CDU/CSU", "SPD", "AfD", "FDP", "Grüne", "Linke", "BSW"],
    21: ["CDU/CSU", "SPD", "AfD", "Grüne", "Linke"],
}
FRAKTIONEN = FRAKTIONEN_BY_WP[21]

# chart-adjusted conventional party colors (all ≥3:1 on white; CDU near-black,
# FDP dark mustard and fraktionslos gray are deliberate — every chart direct-labels)
PARTY_COLORS = {
    "CDU/CSU": "#333333",
    "SPD": "#d61f2e",
    "AfD": "#0090c9",
    "FDP": "#b58900",
    "Grüne": "#3d8a26",
    "Linke": "#b0308a",
    "BSW": "#7d254f",
    "fraktionslos": "#898781",
}


def load_frames(data_dir: Path, wahlperiode: int = 21) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (speeches, events) DataFrames; events are joined with speech metadata."""
    speeches, events = load_term(data_dir, wahlperiode)
    sdf = pd.DataFrame([vars(s) for s in speeches])
    sdf["date"] = pd.to_datetime(sdf["date"], format="%d.%m.%Y")
    edf = pd.DataFrame([vars(e) for e in events])
    # partial applause ("bei Abgeordneten der X") counts half a fraktion
    edf["weight"] = edf["partial"].map({False: 1.0, True: 0.5})
    edf = edf.merge(
        sdf[["rede_id", "wahlperiode", "sitzung", "date", "speaker_id", "speaker", "party", "is_government"]].rename(
            columns={"speaker_id": "to_speaker_id", "speaker": "to_speaker", "party": "to_party"}
        ),
        on="rede_id",
        how="left",
    )
    return sdf, edf


def interaction_matrix(
    edf: pd.DataFrame, sdf: pd.DataFrame, kind: str, fraktionen: list[str] = FRAKTIONEN
) -> pd.DataFrame:
    """Events of one kind, from-party × to-party, per 1,000 spoken words.

    Rows: party of the speaker on the lectern. Columns: fraktion the reaction
    came from. Normalizing on words rather than speeches corrects for unequal
    speaking time (bigger fraktionen get longer slots), following
    Küpfer/Müller/Stecker 2025 (doi:10.1080/01402382.2025.2549149).
    """
    sub = edf[(edf["kind"] == kind) & edf["party"].isin(fraktionen) & edf["to_party"].isin(fraktionen)]
    counts = sub.pivot_table(index="to_party", columns="party", values="weight", aggfunc="sum", fill_value=0.0)
    words_held = sdf[sdf["party"].isin(fraktionen)].groupby("party")["words"].sum() / 1000
    rate = counts.div(words_held, axis=0)
    return rate.reindex(index=fraktionen, columns=fraktionen).fillna(0.0)
