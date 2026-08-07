# bundestagsdaten.de

Analytics on German Bundestag open data — starting with the plenary protocol
`<kommentar>` metadata (Beifall, Zurufe, Lachen …), heading toward a website
at [bundestagsdaten.de](https://bundestagsdaten.de).

## Layout

- `scripts/download_protocols.py` — downloads plenary protocol XMLs from the
  [Bundestag open data portal](https://www.bundestag.de/services/opendata)
  into `data/protocols/` (`uv run scripts/download_protocols.py 21`)
- `btd/parse.py` — parses the `dbtplenarprotokoll` XML into speeches and
  structured kommentar events (kind, source fraktion/person, partial applause,
  verbatim quotes)
- `btd/frames.py` — pandas DataFrames + party colors + interaction matrices
- `notebooks/01_kommentare.ipynb` — first exploration: applause matrix,
  heckling matrix, top speakers/hecklers, self-applause shares

## Setup

```sh
uv sync
uv run scripts/download_protocols.py 21   # ~90 XMLs, ~80 MB
uv run jupyter lab notebooks/
```

## Data notes

- Kommentar attribution coverage: ~99% of events classified and attributed.
- The Bundestag XML occasionally doubles text nodes ("SPDSPD") — the parser
  de-doubles them.
- Speaker `id` is the stable MDB id, joinable with MDB_STAMMDATEN.XML for
  biographic data.
- Government members speak without a fraktion in the protocol; `Speech.party`
  then carries their role (e.g. "Bundesminister BMI").
