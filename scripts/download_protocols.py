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


def list_protocol_urls(term: int) -> list[str]:
    urls: list[str] = []
    offset = 0
    while True:
        resp = requests.get(
            f"{BASE}/ajax/filterlist/de/services/opendata/{LIST_IDS[term]}",
            params={"noFilterSet": "true", "offset": offset},
            timeout=30,
        )
        resp.raise_for_status()
        urls.extend(re.findall(r'href="(https://www\.bundestag\.de/resource/blob/\d+/\d+\.xml)"', resp.text))
        hits = int(re.search(r'data-hits="(\d+)"', resp.text).group(1))
        # the server caps page size at 10 and reports the next offset itself
        offset = int(re.search(r'data-nextoffset="(\d+)"', resp.text).group(1))
        if offset >= hits:
            return urls


def download(term: int) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    urls = list_protocol_urls(term)
    print(f"WP{term}: {len(urls)} protocols listed")
    for url in urls:
        name = url.rsplit("/", 1)[-1]
        target = DATA_DIR / name
        if target.exists():
            continue
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        target.write_bytes(resp.content)
        print(f"  downloaded {name} ({len(resp.content) // 1024} KB)")


if __name__ == "__main__":
    download(int(sys.argv[1]) if len(sys.argv) > 1 else 21)
