#!/usr/bin/env python3
"""Generate every QA Scribe app icon from one shape definition.

The mark is a "Q" ring with a highlighter tail: ink square, paper ring,
highlighter-yellow stroke. The shapes below are the single source; this script
writes the SVG source, the favicon, and every raster the bundles need.

Usage: python3 scripts/generate-app-icon.py   (needs Pillow)
"""
import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CANVAS = 1024
SUPERSAMPLE = 4

INK = '#1a201d'      # --text-primary / --action-primary-fill
PAPER = '#fcfcf9'    # --surface-raised
MARK = '#ffe15c'     # a stronger take on --mark (#fff1ad) so it holds at 16 px

# Geometry on a 1024 grid. The 80 px inset matches the macOS icon template.
SQUARE = (80, 80, 944, 944, 200)               # x0, y0, x1, y1, radius
RING = (512, 496, 256, 104)                    # cx, cy, outer radius, stroke
TAIL = (520, 632, 808, 760, 40)                # x0, y0, x1, y1, radius

LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
# ICNS entry types that carry PNG data, with their pixel sizes (1x and 2x slots).
ICNS_TYPES = [(b'icp4', 16), (b'icp5', 32), (b'ic11', 32), (b'icp6', 64), (b'ic12', 64), (b'ic07', 128),
              (b'ic13', 256), (b'ic08', 256), (b'ic14', 512), (b'ic09', 512), (b'ic10', 1024)]
ICONSET = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]


def svg() -> str:
    x0, y0, x1, y1, r = SQUARE
    cx, cy, outer, stroke = RING
    tx0, ty0, tx1, ty1, tr = TAIL
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}" role="img" aria-label="QA Scribe">
  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}" fill="{INK}"/>
  <circle cx="{cx}" cy="{cy}" r="{outer - stroke / 2:g}" fill="none" stroke="{PAPER}" stroke-width="{stroke}"/>
  <rect x="{tx0}" y="{ty0}" width="{tx1 - tx0}" height="{ty1 - ty0}" rx="{tr}" fill="{MARK}"/>
</svg>
'''


def master() -> Image.Image:
    s = SUPERSAMPLE
    image = Image.new('RGBA', (CANVAS * s, CANVAS * s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    x0, y0, x1, y1, r = SQUARE
    draw.rounded_rectangle([x0 * s, y0 * s, x1 * s, y1 * s], radius=r * s, fill=INK)
    cx, cy, outer, stroke = RING
    draw.ellipse([(cx - outer) * s, (cy - outer) * s, (cx + outer) * s, (cy + outer) * s], outline=PAPER, width=stroke * s)
    tx0, ty0, tx1, ty1, tr = TAIL
    draw.rounded_rectangle([tx0 * s, ty0 * s, tx1 * s, ty1 * s], radius=tr * s, fill=MARK)
    return image


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def icns(entries: list[tuple[bytes, bytes]]) -> bytes:
    body = b''.join(kind + struct.pack('>I', len(data) + 8) + data for kind, data in entries)
    return b'icns' + struct.pack('>I', len(body) + 8) + body


def main() -> None:
    big = master()
    sized = lambda size: big.resize((size, size), Image.LANCZOS)
    source = svg()
    (ROOT / 'build/icons/app-icon.svg').write_text(source)
    (ROOT / 'frontend/public').mkdir(exist_ok=True)
    (ROOT / 'frontend/public/favicon.svg').write_text(source)
    for size in LINUX_SIZES:
        sized(size).save(ROOT / f'build/icons/{size}x{size}.png', optimize=True)
    sized(1024).save(ROOT / 'src-tauri/icons/icon.png', optimize=True)
    iconset = ROOT / 'build/macos/AppIcon.iconset'
    for base, scale in ICONSET:
        suffix = '' if scale == 1 else '@2x'
        sized(base * scale).save(iconset / f'icon_{base}x{base}{suffix}.png', optimize=True)
    (ROOT / 'build/macos/AppIcon.icns').write_bytes(icns([(kind, png_bytes(sized(size))) for kind, size in ICNS_TYPES]))
    print(f'wrote app-icon.svg, favicon.svg, {len(LINUX_SIZES)} Linux PNGs, {len(ICONSET)} iconset PNGs, AppIcon.icns, icon.png')


if __name__ == '__main__':
    main()
