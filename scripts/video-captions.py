#!/usr/bin/env python3
"""Render each cue of an .srt into a PNG caption bar and print the ffmpeg overlay filter chain that burns them in.

Used by scripts/video-post.sh because the local ffmpeg build has no libass/freetype (no `subtitles`/`drawtext`).
  python3 scripts/video-captions.py <captions.srt> <out-dir> <video-width>   → prints the -filter_complex string
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

srt, out_dir, width = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)
FONT = next(
    (p for p in ['/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf'] if Path(p).exists()), None
)
font = ImageFont.truetype(FONT, 26) if FONT else ImageFont.load_default()
PAD, MARGIN_V = 14, 30


def seconds(ts: str) -> float:
    h, m, s = ts.replace(',', '.').split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


cues = []
for block in re.split(r'\n\s*\n', srt.read_text().strip()):
    lines = block.strip().splitlines()
    if len(lines) < 3:
        continue
    start, end = [seconds(t.strip()) for t in lines[1].split('-->')]
    cues.append((start, end, ' '.join(l.strip() for l in lines[2:])))

inputs, chain, prev = [], [], '[0:v]'
for i, (start, end, text) in enumerate(cues):
    # Word-wrap to ~85% of the frame width.
    words, rows, row = text.split(), [], ''
    for w in words:
        cand = (row + ' ' + w).strip()
        if font.getlength(cand) > width * 0.85 and row:
            rows.append(row)
            row = w
        else:
            row = cand
    rows.append(row)
    line_h = font.getbbox('Ag')[3] + 8
    box_w = int(max(font.getlength(r) for r in rows)) + PAD * 2
    box_h = line_h * len(rows) + PAD * 2
    img = Image.new('RGBA', (box_w, box_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, box_w - 1, box_h - 1], radius=10, fill=(12, 12, 20, 170))
    for r_i, r in enumerate(rows):
        d.text((PAD, PAD + r_i * line_h), r, font=font, fill=(255, 255, 255, 255))
    png = out_dir / f'cue{i:02d}.png'
    img.save(png)
    inputs.append(f'-i {png}')
    nxt = f'[v{i}]' if i < len(cues) - 1 else '[vout]'
    chain.append(
        f"{prev}[{i + 1}:v]overlay=x=(W-w)/2:y=H-h-{MARGIN_V}:enable='between(t,{start:.2f},{end:.2f})'{nxt}"
    )
    prev = nxt
print(' '.join(inputs))
print(';'.join(chain))
