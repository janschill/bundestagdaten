"""Turn parsed protocols into analysis-ready pandas DataFrames."""

from pathlib import Path

import pandas as pd

from btd.parse import load_term

FRAKTIONEN = ["CDU/CSU", "SPD", "AfD", "Grüne", "Linke"]

# chart-adjusted conventional party colors (validated: CVD ΔE 21.7, all ≥3:1 on white;
# CDU near-black and fraktionslos gray are deliberate — every chart direct-labels)
PARTY_COLORS = {
    "CDU/CSU": "#333333",
    "SPD": "#d61f2e",
    "AfD": "#0090c9",
    "Grüne": "#3d8a26",
    "Linke": "#b0308a",
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
        sdf[["rede_id", "sitzung", "date", "speaker_id", "speaker", "party", "is_government"]].rename(
            columns={"speaker_id": "to_speaker_id", "speaker": "to_speaker", "party": "to_party"}
        ),
        on="rede_id",
        how="left",
    )
    return sdf, edf


def interaction_matrix(edf: pd.DataFrame, sdf: pd.DataFrame, kind: str) -> pd.DataFrame:
    """Events of one kind, from-party × to-party, normalized per speech held.

    Rows: party of the speaker on the lectern. Columns: fraktion the reaction
    came from. Values: weighted events per speech, so parties with more
    speaking time don't dominate.
    """
    sub = edf[(edf["kind"] == kind) & edf["party"].isin(FRAKTIONEN) & edf["to_party"].isin(FRAKTIONEN)]
    counts = sub.pivot_table(index="to_party", columns="party", values="weight", aggfunc="sum", fill_value=0.0)
    speeches_held = sdf[sdf["party"].isin(FRAKTIONEN)].groupby("party").size()
    rate = counts.div(speeches_held, axis=0)
    return rate.reindex(index=FRAKTIONEN, columns=FRAKTIONEN)
