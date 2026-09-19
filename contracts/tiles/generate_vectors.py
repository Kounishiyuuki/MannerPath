# Independent generator (Python, asinh form) for the tile vectors. Output is committed and frozen;
# run `python3 contracts/tiles/generate_vectors.py > contracts/tiles/slippy-xyz-vectors.v1.json` only to add cases.
import math, json
MAXLAT = 85.05112877980659
def tile(lat, lon, z):
    n = 2 ** z
    x = math.floor((lon + 180) / 360 * n) % n
    lat = max(-MAXLAT, min(MAXLAT, lat))
    y = math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, max(0, min(n - 1, y))
def ylat(y, z):  # north edge latitude of row y
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))
cases = []
def add(name, lat, lon, z, note=None):
    x, y = tile(lat, lon, z)
    c = {"name": name, "lat": lat, "lon": lon, "z": z, "x": x, "y": y, "tileId": f"{z}/{x}/{y}"}
    if note: c["note"] = note
    cases.append(c)
add("origin z0", 0.0, 0.0, 0)
add("origin z1 is south-east quadrant (half-open edges)", 0.0, 0.0, 1, "lat 0 and lon 0 are tile edges; an edge belongs to the tile east/south of it")
add("origin z14", 0.0, 0.0, 14)
add("just north-west of origin z14", 1e-9, -1e-9, 14)
add("west edge lon -180", 10.0, -180.0, 14)
add("antimeridian lon 180 wraps to x=0", 10.0, 180.0, 14, "lon 180 is the same meridian as lon -180")
add("just west of antimeridian", 10.0, 179.9999999, 14)
add("north mercator limit", MAXLAT, 0.0, 14)
add("north pole clamps to y=0", 90.0, 0.0, 14, "latitudes beyond +-85.05112877980659 clamp; they are not rejected")
add("south pole clamps to y=n-1", -90.0, 0.0, 14)
add("south mercator limit", -MAXLAT, 0.0, 14)
add("southern hemisphere", -33.8688, 151.2093, 14)
add("western hemisphere", 40.7128, -74.006, 14)
# Tokyo / Taito fixture points (records 1, 4, 32, 34 of 20260818_koshukitsuenjo.csv)
add("Taito #1 上野公園前交番裏", 35.7112, 139.77377, 14)
add("Taito #4 浅草寺境内", 35.71361, 139.79737, 14)
add("Taito #32 e-booth御徒町", 35.706313, 139.77347, 14)
add("Taito #34 千束通り商店街", 35.719649, 139.79532, 14)
# Near-boundary around the Taito tile: tile edges +-1e-7 degrees (~1 cm)
x0, y0 = tile(35.7112, 139.77377, 14)
xe = x0 * 360 / 2**14 - 180
ye = ylat(y0, 14)
add("1e-7 deg west of a z14 column edge in Taito", 35.7112, xe - 1e-7, 14)
add("1e-7 deg east of a z14 column edge in Taito", 35.7112, xe + 1e-7, 14)
add("1e-7 deg north of a z14 row edge in Taito", ye + 1e-7, 139.77377, 14)
add("1e-7 deg south of a z14 row edge in Taito", ye - 1e-7, 139.77377, 14)
add("exact column edge in Taito belongs to the east tile", 35.7112, xe, 14, "x edges are exactly representable at z14 in this case; row edges are irrational so no exact-row-edge vector is given")
for c in cases:
    # guard: generator must not sit within float noise of an edge
    n = 2 ** c["z"]
    fy = (1 - math.asinh(math.tan(math.radians(max(-MAXLAT, min(MAXLAT, c["lat"]))))) / math.pi) / 2 * n
    if 0 < round(fy) < n and abs(fy - round(fy)) < 1e-9 and c["lat"] != 0.0:
        raise SystemExit("ambiguous y: " + c["name"])
invalid = [
    {"name": "latitude above 90", "lat": 90.000001, "lon": 0.0, "z": 14},
    {"name": "latitude below -90", "lat": -91.0, "lon": 0.0, "z": 14},
    {"name": "longitude above 180", "lat": 0.0, "lon": 180.000001, "z": 14},
    {"name": "longitude below -180", "lat": 0.0, "lon": -180.5, "z": 14},
    {"name": "negative zoom", "lat": 0.0, "lon": 0.0, "z": -1},
    {"name": "zoom above 30", "lat": 0.0, "lon": 0.0, "z": 31},
]
ids = {
  "valid": [{"tileId": "14/14552/6450", "z": 14, "x": 14552, "y": 6450}, {"tileId": "0/0/0", "z": 0, "x": 0, "y": 0}, {"tileId": "14/16383/16383", "z": 14, "x": 16383, "y": 16383}],
  "invalid": ["14/16384/0", "14/0/16384", "14/014552/6450", "14/-1/0", "14/1.5/0", "14/1/2/3", "14/1", "", " 14/1/2", "14/1/2 ", "31/0/0", "+14/1/2", "14/1e3/2"],
}
out = {
  "contract": "mannerpath-slippy-xyz-tile-vectors",
  "version": 1,
  "rules": [
    "Web Mercator Slippy XYZ. n = 2^z; z is an integer in [0, 30].",
    "Inputs must be finite; lat in [-90, 90] and lon in [-180, 180] inclusive. Anything else is an error, not a clamp.",
    "x = floor((lon + 180) / 360 * n) mod n. lon 180 is the antimeridian and maps to x = 0.",
    "lat is clamped to [-85.05112877980659, 85.05112877980659] before projection; y = floor((1 - ln(tan(phi) + sec(phi)) / pi) / 2 * n), then clamped to [0, n-1].",
    "Tile edges are half-open: a point exactly on an edge belongs to the tile east (x) or south (y) of it.",
    "Tile ID is \"{z}/{x}/{y}\" in base-10 without sign, padding, whitespace or exponent; 0 <= x, y < n.",
    "Data tiles use DATA_TILE_ZOOM = 14 (ADR-0005); other zooms appear here only to pin the math."
  ],
  "coordinateToTile": cases,
  "invalidCoordinates": invalid,
  "tileIds": ids,
}
print(json.dumps(out, ensure_ascii=False, indent=2))
