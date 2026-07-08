"""
Extract brand-correct Phantom + Rabby SVG strings from the
@web3icons/core npm tarball and write them as plain .svg files
under frontend/public/wallets/.

The branded variants are visually faithful to the wallets:
  - Phantom uses fill #AB9FF2 (the official Phantom purple) and a
    stylized spirit/ghost body with two eye dots.
  - Rabby uses four linear gradients and the rabbit mascot with
    ears and a body curve.

Run:
  python frontend/scripts/extract-wallet-icons.py

After running, you should see:
  frontend/public/wallets/phantom.svg
  frontend/public/wallets/rabby.svg
"""
import os
import re

SRC = r"C:\Users\AGBSST~1\AppData\Local\Temp\wcore\package\dist\svgs\wallets\branded"
DST = r"C:\Users\AGBS Studio\ZCodeProject\Universal-Privacy-Layer\frontend\public\wallets"
os.makedirs(DST, exist_ok=True)

# Parses `var phantom = '...'` — the SVG is a single-quoted JS string
# with `\n` and `\'` escapes. We match the whole body lazily up to the
# closing single quote.
PATTERN = re.compile(r"var \w+ =\s*'((?:[^'\\]|\\.)*)'", re.DOTALL)

for name in ("phantom", "rabby"):
    src_path = os.path.join(SRC, f"{name}.svg.js")
    if not os.path.exists(src_path):
        print(f"SKIP {name}: source not found at {src_path}")
        continue
    with open(src_path, "r", encoding="utf-8") as f:
        js = f.read()
    m = PATTERN.search(js)
    if not m:
        print(f"FAIL {name}: cannot parse svg string")
        continue
    raw = m.group(1)
    svg = raw.encode("utf-8").decode("unicode_escape")
    out_path = os.path.join(DST, f"{name}.svg")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write(svg)
    print(f"OK {name}.svg → {out_path} ({len(svg)} chars)")
