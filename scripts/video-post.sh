#!/usr/bin/env bash
# Trim a QuickTime screen recording, burn the captions in, and check the hackathon's 3-minute cap.
#   scripts/video-post.sh <input.mov> [start=00:00:00] [end=00:02:50] [out=docs/video/demo.mp4]
# Captions: docs/video/captions.srt, times relative to the TRIMMED clip (adjust after the final take).
# The local ffmpeg has no libass/freetype, so captions are rendered to PNGs by scripts/video-captions.py (Pillow)
# and overlaid; any ffmpeg build works.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
in="${1:?input recording}"; start="${2:-00:00:00}"; end="${3:-00:02:50}"; out="${4:-$here/docs/video/demo.mp4}"
srt="$here/docs/video/captions.srt"; tmp="$(mktemp -d)"; trimmed="$tmp/trimmed.mp4"
ffmpeg -y -hide_banner -loglevel error -ss "$start" -to "$end" -i "$in" -vf "scale=1280:-2" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 128k "$trimmed"
gen="$(python3 "$here/scripts/video-captions.py" "$srt" "$tmp/cues" 1280)"
inputs="$(printf '%s\n' "$gen" | sed -n 1p)"; chain="$(printf '%s\n' "$gen" | sed -n 2p)"
# shellcheck disable=SC2086
ffmpeg -y -hide_banner -loglevel error -i "$trimmed" $inputs -filter_complex "$chain" -map '[vout]' -map '0:a?' \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$out"
rm -rf "$tmp"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
printf 'wrote %s — %.1f s ' "$out" "$dur"
awk -v d="$dur" 'BEGIN { if (d < 175) print "(under the 2:55 target, OK)"; else { print "(TOO LONG — must be under 3:00, aim < 2:55)"; exit 1 } }'
