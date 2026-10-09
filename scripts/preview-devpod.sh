#!/usr/bin/env bash
# Builds a copy of the site into dist-preview/ that works under the devpod proxy sub-path.
# Serve it with: devpod serve <repo>/dist-preview   (then pass the printed proxy path here)
# Usage: scripts/preview-devpod.sh /proxy/<devpod>/<port>/
set -euo pipefail
cd "$(dirname "$0")/.."
npx astro build --base "$1" --outDir dist-preview
