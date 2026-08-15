"""Generate the OpenGraph image, apple-touch-icon and PNG favicon variants
for bundestagsdaten.de. The wide wordmark PNG at the repo root is the only
source asset; everything here is derived from it.

Output lives under site/img/:
  og.png             1200x630 social card
  apple-touch-icon.png   180x180 home-screen icon
  favicon-32.png          32x32
  favicon-16.png          16x16

Run: uv run scripts/make_images.py
Re-runs cheaply; overwrite-if-different is the caller's job.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
IMG_DIR = SITE / "img"
LOGO = ROOT / "bundestagsdaten-logo.png"

SURFACE = (252, 252, 251, 255)      # var(--surface)
INK = (27, 26, 23, 255)             # var(--ink)
INK2 = (82, 81, 78, 255)            # var(--ink2)
ACCENT = (74, 85, 144, 255)         # var(--accent)
MUTED = (137, 135, 129, 255)        # var(--muted)

TAGLINE = "Beifall · Zurufe · Lachen im Bundestag"


def _font(size: int, weight: int = 400) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if weight >= 600 else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if weight >= 600 else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    return ImageFont.load_default()


def make_og() -> bytes:
    """1200x630 card: wordmark centered on --surface, tagline below in --accent."""
    canvas = Image.new("RGBA", (1200, 630), SURFACE)

    logo = Image.open(LOGO).convert("RGBA")
    max_w = 880
    if logo.width > max_w:
        scale = max_w / logo.width
        logo = logo.resize((max_w, max(1, int(logo.height * scale))), Image.LANCZOS)

    x = (canvas.width - logo.width) // 2
    y = 220 - logo.height // 2
    canvas.alpha_composite(logo, (x, y))

    tagline_font = _font(40, weight=400)
    eyebrow_font = _font(22, weight=600)
    draw = ImageDraw.Draw(canvas)

    eyebrow = "PLENARPROTOKOLLE · SEIT 1949"
    eb_bbox = draw.textbbox((0, 0), eyebrow, font=eyebrow_font)
    eb_w = eb_bbox[2] - eb_bbox[0]
    draw.text(((canvas.width - eb_w) // 2, 360), eyebrow, font=eyebrow_font, fill=MUTED)

    tb_bbox = draw.textbbox((0, 0), TAGLINE, font=tagline_font)
    tb_w = tb_bbox[2] - tb_bbox[0]
    draw.text(((canvas.width - tb_w) // 2, 420), TAGLINE, font=tagline_font, fill=ACCENT)

    return _save_png(canvas.convert("RGB"), "og.png")


def make_apple_touch() -> bytes:
    """180x180 home-screen icon: --accent tile with white 'B' wordmark."""
    canvas = Image.new("RGBA", (180, 180), ACCENT)
    draw = ImageDraw.Draw(canvas)
    font = _font(120, weight=700)
    bbox = draw.textbbox((0, 0), "B", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((180 - w) // 2 - bbox[0], (180 - h) // 2 - bbox[1] - 8), "B", font=font, fill=(255, 255, 255, 255))
    return _save_png(canvas, "apple-touch-icon.png")


def make_favicon(size: int, name: str) -> bytes:
    canvas = Image.new("RGBA", (size, size), ACCENT)
    draw = ImageDraw.Draw(canvas)
    font = _font(int(size * 0.75), weight=700)
    bbox = draw.textbbox((0, 0), "B", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((size - w) // 2 - bbox[0], (size - h) // 2 - bbox[1] - int(size * 0.05)),
        "B", font=font, fill=(255, 255, 255, 255),
    )
    return _save_png(canvas, name)


def _save_png(image: Image.Image, name: str) -> bytes:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    path = IMG_DIR / name
    image.save(path, "PNG")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")
    return path.read_bytes()


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    make_og()
    make_apple_touch()
    make_favicon(32, "favicon-32.png")
    make_favicon(16, "favicon-16.png")


if __name__ == "__main__":
    main()
