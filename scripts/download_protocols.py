"""Download Bundestag plenary protocol XMLs (open data portal) into data/protocols/.

The Bundestag lists protocol XMLs per electoral term behind an AJAX endpoint.
WP21: list id 1058442-1058442, WP20: 866354-866354.
"""

import re
import sys
from pathlib import Path

import requests

LIST_IDS = {
    21: "1058442-1058442",
    20: "866354-866354",
}
BASE = "https://www.bundestag.de"
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "protocols"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "de-DE,de;q=0.9",
}


def list_protocol_urls(term: int) -> list[str]:
    """Page through the filterlist endpoint until it returns an empty page.

    August 2026 markup: 10 items per page, each linked twice (icon + title
    anchor), no data-hits/data-nextoffset attributes anymore. The offset
    parameter counts items, so advance by unique URLs per page.
    """
    urls: list[str] = []
    offset = 0
    session = requests.Session()
    session.headers.update(HEADERS)
    while True:
        resp = session.get(
            f"{BASE}/ajax/filterlist/de/services/opendata/{LIST_IDS[term]}",
            params={"noFilterSet": "true", "offset": offset},
            timeout=30,
        )
        resp.raise_for_status()
        page = list(dict.fromkeys(
            re.findall(r'href="(https://www\.bundestag\.de/resource/blob/\d+/\d+\.xml)"', resp.text)
        ))
        if not page:
            if offset == 0:
                raise RuntimeError(f"no protocol links at offset 0: {resp.text[:500]!r}")
            return list(dict.fromkeys(urls))
        urls.extend(page)
        offset += len(page)


def download(term: int) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    urls = list_protocol_urls(term)
    print(f"WP{term}: {len(urls)} protocols listed")
    for url in urls:
        name = url.rsplit("/", 1)[-1]
        target = DATA_DIR / name
        if target.exists():
            continue
        resp = requests.get(url, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        target.write_bytes(resp.content)
        print(f"  downloaded {name} ({len(resp.content) // 1024} KB)")


if __name__ == "__main__":
    download(int(sys.argv[1]) if len(sys.argv) > 1 else 21)
