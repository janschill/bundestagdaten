# bundestagsdaten.de

Analytics on German Bundestag open data — starting with the plenary protocol
`<kommentar>` metadata (Beifall, Zurufe, Lachen …), heading toward a website
at [bundestagsdaten.de](https://bundestagsdaten.de).

## How it works

Fully serverless: `.github/workflows/publish.yml` runs daily, downloads any
new protocol XMLs (cached between runs, never committed), regenerates the
JSON aggregates in `site/data/`, commits them, and deploys `site/` to
GitHub Pages.

## Layout

- `scripts/download_protocols.py` — downloads plenary protocol XMLs from the
  [Bundestag open data portal](https://www.bundestag.de/services/opendata)
  into `data/protocols/` (`uv run scripts/download_protocols.py 19 20 21`)
- `btd/parse.py` — parses the `dbtplenarprotokoll` XML into speeches and
  structured kommentar events (kind, source fraktion/person, partial applause,
  verbatim quotes)
- `btd/frames.py` — pandas DataFrames + party colors + interaction matrices
- `scripts/export_json.py` — writes the site's data files to `site/data/`
- `site/` — the static website (plain HTML/CSS/JS, no dependencies)
- `notebooks/01_kommentare.ipynb` — first exploration: applause matrix,
  heckling matrix, top speakers/hecklers, self-applause shares

## Setup

```sh
uv sync
uv run scripts/download_protocols.py 19 20 21   # ~540 XMLs, ~450 MB
uv run jupyter lab notebooks/
```

## Local site

```sh
uv run scripts/export_json.py
python3 -m http.server -d site
```

## Custom domain

GitHub Pages is deployed from the workflow. To serve it at
[bundestagsdaten.de](https://bundestagsdaten.de): set the custom domain in the
repo's Pages settings, then at the registrar point `A`/`AAAA` records for the
apex at GitHub Pages (185.199.108.153 …111.153) and a `www` CNAME at
`janschill.github.io`.

## Data notes

- Kommentar attribution coverage: ~99% of events classified and attributed.
- The Bundestag XML occasionally doubles text nodes ("SPDSPD") — the parser
  de-doubles them.
- Speaker `id` is the stable MDB id, joinable with MDB_STAMMDATEN.XML for
  biographic data.
- Government members speak without a fraktion in the protocol; `Speech.party`
  then carries their role (e.g. "Bundesminister BMI").
