"""Download Bundestag plenary protocols from the open data portal.

WP19+ come as individual structured XMLs (data/protocols/), listed per term
behind an AJAX endpoint. WP1-18 exist only as one ZIP of plain-text XMLs per
term (data/archives/pp<NN>.zip); they are parsed straight from the archive.
"""

import re
import sys
import time
from pathlib import Path

import requests

LIST_IDS = {
    21: "1058442-1058442",
    20: "866354-866354",
    19: "543410-543410",
}
ARCHIVE_LIST_ID = "488214-488214"  # pp01.zip … pp19.zip, one per term
BASE = "https://www.bundestag.de"
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "protocols"
ARCHIVE_DIR = Path(__file__).resolve().parent.parent / "data" / "archives"
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


def fetch(url: str) -> bytes:
    for attempt in range(4):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=60)
            resp.raise_for_status()
            return resp.content
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def list_archive_urls() -> dict[int, str]:
    """Map term -> ZIP URL from the historical-archives list."""
    urls: dict[int, str] = {}
    offset = 0
    while True:
        resp = requests.get(
            f"{BASE}/ajax/filterlist/de/services/opendata/{ARCHIVE_LIST_ID}",
            params={"noFilterSet": "true", "offset": offset},
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        page = {
            int(m.group(2)): m.group(1)
            for m in re.finditer(r'href="(https://www\.bundestag\.de/resource/blob/\d+/pp(\d+)\.zip)"', resp.text)
        }
        new = {term: url for term, url in page.items() if term not in urls}
        if not new:
            return urls
        urls.update(new)
        offset += len(page)


def download(term: int) -> None:
    if term >= 19:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        urls = list_protocol_urls(term)
        print(f"WP{term}: {len(urls)} protocols listed")
        for url in urls:
            name = url.rsplit("/", 1)[-1]
            target = DATA_DIR / name
            if target.exists():
                continue
            content = fetch(url)
            target.write_bytes(content)
            print(f"  downloaded {name} ({len(content) // 1024} KB)")
        return
    target = ARCHIVE_DIR / f"pp{term:02d}.zip"
    if target.exists():
        return
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    content = fetch(list_archive_urls()[term])
    target.write_bytes(content)
    print(f"WP{term}: downloaded {target.name} ({len(content) // 1024 // 1024} MB)")


if __name__ == "__main__":
    for term in [int(arg) for arg in sys.argv[1:]] or [21]:
        download(term)
