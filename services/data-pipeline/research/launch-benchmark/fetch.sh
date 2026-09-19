#!/usr/bin/env bash
# Downloads benchmark inputs into .cache/ (gitignored) and prints their hashes.
# Research only: the OSM extract is used for density measurement and is never
# committed or published (DATA_POLICY.md: OSM publication is gated).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .cache

TAITO_URL="https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv"
curl -fsS -o .cache/taito.csv "$TAITO_URL"

# One-off Overpass query: amenity=smoking_area and shop=convenience in Tokyo's 23 special wards.
OVERPASS_QUERY='[out:json][timeout:120];area["name:en"="Tokyo"]["admin_level"="4"]->.t;(area["name"~"区$"]["admin_level"="7"](area.t);)->.w;(nwr["amenity"="smoking_area"](area.w);nwr["shop"="convenience"](area.w););out center tags;'
if [[ "${SKIP_OSM:-0}" != "1" ]]; then
  curl -fsS -m 180 -A "MannerPath-research (launch-density benchmark)" \
    --data-urlencode "data=$OVERPASS_QUERY" \
    -o .cache/osm_23wards.json https://overpass-api.de/api/interpreter
fi

shasum -a 256 .cache/*
