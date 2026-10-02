// Replay of committed nationwide research under ADR-0017 (approximate area locations). Local and read-only: it
// fetches nothing, approves nothing, publishes nothing and rescues nothing automatically.
// Usage: npm run replay:approximate [-- --json]
//
// Input: every committed review record. The official reverse review (2026-10-01, 190 targets, structured fields) is
// the latest bounded review of every discovery target; older dataset-level reviews whose key is not one of those
// targets are replayed too, from their blocker codes. ANNOTATIONS is the hand review this replay adds: for each
// target with explicit smoking-place evidence, how the record locates the places (inside a named area/host, by
// street address only, or not established), the place count the record states, and whether a reusable anchor
// exists under anchor policy v1 (the existence source's own point for the area). Each note cites the review text.

import { readFileSync } from "node:fs";
import { APPROXIMATE_REPLAY_VERSION, type LocationForm, RIGHTS, type ReplayRecord, classifyApproximate } from "../src/quality/approximate-replay.ts";
import { blockerCodes } from "../src/quality/coverage-replay.ts";

const DIR = new URL("../../../docs/research/nationwide-discovery/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), "utf8"));

type Location = LocationForm;
interface Annotation { location: Location; spots: number | null; anchor?: boolean; explicit?: boolean; note: string }

// Hand review of the committed records (2026-10-02). `spots` is only a count the record itself states.
const ANNOTATIONS: Record<string, Annotation> = {
  "city-sendai": { location: "areaOrHost", spots: 1, anchor: true, explicit: true, note: "east-deep: the park raw lists 海岸公園（井土地区） with smoking among its amenities at the park's own Point (same dataset): explicit existence inside a park with a same-source anchor. Reverse review: resource rights unreviewed." },
  "city-niigata": { location: "areaOrHost", spots: 2, note: "east-deep: station south gate and 石宮公園 sites explicit; park/GIS points exist only in separate datasets (CC BY 2.1 JP) — not an anchor under policy v1; former station-front site closed 2024-08-05 is excluded." },
  "city-chiba": { location: "areaOrHost", spots: 1, note: "Kaihin-Makuhari under-track facility; the CC BY 4.0 host-facility CSV is a separate dataset with zero smoking rows (not a v1 anchor)." },
  "city-kawasaki": { location: "addressOnly", spots: 12, note: "12 designated sites with addresses and relative descriptions; station/building coordinates must not substitute (review): ADR-0011 territory." },
  "city-yokohama": { location: "unestablished", spots: null, note: "new smoking facilities and a closed former station site; map export failed, location form unknown." },
  "city-fukushima": { location: "areaOrHost", spots: 2, note: "two station designated smoking booths; Google Maps positions excluded." },
  "city-utsunomiya": { location: "areaOrHost", spots: 1, note: "Orion Square designated smoking place." },
  "city-saitama": { location: "unestablished", spots: null, note: "2021 list of street-ban exception places; location form not recorded." },
  "city-kanazawa": { location: "areaOrHost", spots: null, note: "station facility page directs to smoking places." },
  "city-fukui": { location: "areaOrHost", spots: 1, note: "relocated indoor station smoking facility." },
  "city-shizuoka": { location: "unestablished", spots: null, note: "positions only via Google Maps links (excluded)." },
  "city-nagoya": { location: "addressOnly", spots: 3, note: "three station-area installations by address/diagram." },
  "city-otsu": { location: "unestablished", spots: 3, note: "three station-area pilot places with diagrams; not stated as inside a station." },
  "city-kyoto": { location: "none", spots: null, note: "existing pinned release already published." },
  "city-hiroshima": { location: "areaOrHost", spots: 6, note: "six smoking booths in city parks." },
  "city-takamatsu": { location: "unestablished", spots: null, note: "active facilities and construction closures; per-record review needed." },
  "city-saga": { location: "unestablished", spots: null, note: "municipal map of smoking spots; reusable points unestablished." },
  "city-nagasaki": { location: "unestablished", spots: null, note: "manager-installed public ashtrays on a map page." },
  "city-miyazaki": { location: "unestablished", spots: 3, note: "three designated places, two relocated." },
  "city-sagamihara": { location: "unestablished", spots: 8, note: "eight station-area designated places." },
  "city-sakai": { location: "unestablished", spots: 10, note: "ten designated places; external map positions excluded." },
  "city-musashino": { location: "none", spots: 1, note: "existing pinned KML publishes three of four; the fourth needs a new release." },
  "ward-chiyoda": { location: "addressOnly", spots: null, note: "station-area addresses and hours." },
  "ward-chuo": { location: "exactPoint", spots: 79, note: "high-value review: 79 smoking-labelled map_data.csv rows with publisher lat/lng; reuse forbidden by website terms. Exact points exist, so ADR-0017 is not the blocker." },
  "ward-minato": { location: "none", spots: null, note: "existing approved pinned release." },
  "ward-shinjuku": { location: "unestablished", spots: null, note: "station-area facilities; GIS catalog has no smoking release." },
  "ward-bunkyo": { location: "addressOnly", spots: null, note: "addresses and selected hours; Google positions excluded." },
  "ward-taito": { location: "none", spots: null, note: "existing pinned release." },
  "ward-sumida": { location: "addressOnly", spots: null, note: "places by station district with addresses." },
  "ward-koto": { location: "none", spots: null, note: "existing pinned station release." },
  "ward-shinagawa": { location: "addressOnly", spots: null, note: "addresses/hours with temporary-closure cautions." },
  "ward-ota": { location: "addressOnly", spots: null, note: "station facilities with addresses and hours." },
  "ward-shibuya": { location: "unestablished", spots: null, note: "PDF not decoded." },
  "ward-nakano": { location: "unestablished", spots: null, note: "station inventory and a reopening notice." },
  "ward-toshima": { location: "unestablished", spots: null, note: "inventory and container-facility opening notice." },
  "ward-kita": { location: "unestablished", spots: null, note: "opened facilities vs planned construction." },
  "ward-arakawa": { location: "unestablished", spots: null, note: "publicly accessible facilities, no reusable Point." },
  "ward-itabashi": { location: "addressOnly", spots: null, note: "addresses/hours and operator distinctions." },
  "ward-nerima": { location: "areaOrHost", spots: null, note: "station-specific smoking-facility guidance with diagrams." },
  "ward-adachi": { location: "unestablished", spots: null, note: "installation history, not current operation." },
  "ward-katsushika": { location: "unestablished", spots: null, note: "abolished vs operating facilities." },
  "ward-edogawa": { location: "areaOrHost", spots: null, note: "station smoking facilities; the general facility CSV must not be joined (review) — no anchor." },
  "operator-jr-hokkaido": { location: "areaOrHost", spots: 10, note: "ten stations with smoking rooms." },
  "operator-jr-west": { location: "areaOrHost", spots: null, note: "smoking-room stations listed." },
  "operator-jr-kyushu": { location: "areaOrHost", spots: 4, note: "Hakata, Kumamoto, Kagoshima-Chuo, Nagasaki." },
  "operator-haneda": { location: "areaOrHost", spots: null, note: "by terminal, floor and access area." },
  "operator-narita": { location: "areaOrHost", spots: null, note: "rooms throughout terminals via locator." },
  "operator-kansai-airports": { location: "areaOrHost", spots: null, note: "terminal smoking rooms." },
  "operator-hokkaido-airports": { location: "areaOrHost", spots: null, note: "New Chitose rooms by terminal and floor." },
  "operator-sendai-airport": { location: "areaOrHost", spots: 5, note: "four rooms + two heated-only, one closed 2026-03-02 (conflict to reconcile)." },
  "operator-fukuoka-airport": { location: "areaOrHost", spots: null, note: "some rooms currently unusable (conflict to reconcile)." },
  "operator-jr-central-building": { location: "areaOrHost", spots: 2, note: "smoking rooms on floors 12/13 of two towers." },
  "operator-aomori-airport": { location: "areaOrHost", spots: 4, note: "four smoking places inside the terminal." },
};

interface Reverse {
  targetId: string; jurisdiction: string; prefecture?: string | null; blockerCodes: string[]; explicitSmokingPlaceInformation: boolean;
  smokingEvidence: string; currentOperation: string; reason: string; approvalStatus: string; reviewStatus: string;
}

const reverse: Reverse[] = read("2026-10-01-official-reverse-reviews.json");
const reverseIds = new Set(reverse.map((r) => r.targetId));
const legacyFiles: [string, { targetId?: string; jurisdiction: string; blockerCodes: string[] | string; reason?: string }[]][] = [
  ["2026-09-30-reviews.json", read("2026-09-30-reviews.json")],
  ["2026-10-01-v2-reviews.json", read("2026-10-01-v2-reviews.json").reviews],
  ["2026-10-01-west-reviews.json", read("2026-10-01-west-reviews.json")],
  ["2026-10-01-east-deep-reviews.json", read("2026-10-01-east-deep-reviews.json")],
  ["2026-10-01-high-value-reviews.json", read("2026-10-01-high-value-reviews.json")],
];

const records: (ReplayRecord & { file: string; spots: number | null; note: string | null; locationForm: Location })[] = [];
for (const r of reverse) {
  const a = ANNOTATIONS[r.targetId];
  const explicit = a?.explicit ?? r.explicitSmokingPlaceInformation;
  const locationForm: Location = a?.location ?? (explicit ? "unestablished" : "none");
  records.push({
    file: "2026-10-01-official-reverse-reviews.json", targetId: r.targetId, jurisdiction: r.jurisdiction, prefecture: r.prefecture ?? null,
    blockerCodes: r.blockerCodes, explicitExistence: explicit,
    location: locationForm, locationForm,
    reusableAnchor: a?.anchor ?? false, alreadyPublished: r.approvalStatus === "existingPinned",
    text: `${r.smokingEvidence} ${r.currentOperation}`, spots: a?.spots ?? null, note: a?.note ?? null,
  });
}
// Older dataset-level reviews of things the reverse review does not key (a dataset, not a discovery target).
const legacy = new Map<string, { file: string; r: { jurisdiction: string; blockerCodes: string[] | string; reason?: string } }>();
for (const [file, list] of legacyFiles) for (const r of list) {
  const key = r.targetId ?? r.jurisdiction;
  if (!reverseIds.has(key)) legacy.set(key, { file, r });
}
for (const [key, { file, r }] of legacy) {
  const codes = blockerCodes({ jurisdiction: r.jurisdiction, verdict: "", blockerCodes: r.blockerCodes });
  const duplicate = codes.length > 0 && codes.every((c) => c === "duplicateKnownResearch");
  records.push({
    file, targetId: key, jurisdiction: r.jurisdiction, prefecture: null, blockerCodes: codes,
    // A dataset review recorded no explicit-existence finding; none is assumed.
    explicitExistence: false, location: "none", locationForm: "none", reusableAnchor: false, alreadyPublished: duplicate,
    text: r.reason ?? "", spots: null, note: null,
  });
}

// What would block each target if its reuse rights were granted: the category ADR-0017 work can act on next.
const rows = records.map((r) => ({
  ...r, ...classifyApproximate(r),
  categoryIfRightsGranted: classifyApproximate({ ...r, blockerCodes: r.blockerCodes.filter((c) => !RIGHTS.includes(c)) }).category,
})).sort((a, b) => (a.targetId < b.targetId ? -1 : 1));
const count = (values: string[]) => Object.fromEntries([...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort());
const eligible = rows.filter((r) => r.adr0017RemovesLocationBlocker && !r.alreadyPublished);
const summary = {
  candidatesReplayed: rows.length,
  officialReverseTargets: reverse.length,
  legacyDatasetReviews: legacy.size,
  categories: count(rows.map((r) => r.category)),
  categoriesIfRightsGranted: count(rows.map((r) => r.categoryIfRightsGranted)),
  rescuedIfRightsGranted: rows.filter((r) => r.categoryIfRightsGranted === "A-rescuedByAreaApproximate").map((r) => r.targetId),
  rescuedSources: rows.filter((r) => r.category === "A-rescuedByAreaApproximate").map((r) => r.targetId),
  locationBlockerRemovedByAdr0017: eligible.map((r) => r.targetId),
  potentialSpotsStated: eligible.reduce((n, r) => n + (r.spots ?? 0), 0),
  potentialTargetsWithoutStatedCount: eligible.filter((r) => r.spots === null).length,
  actuallyOnboardableSpots: rows.filter((r) => r.category === "A-rescuedByAreaApproximate").reduce((n, r) => n + (r.spots ?? 0), 0),
  newPrefecturesNow: [] as string[],
  potentialNewPrefecturesIfRightsGranted: [...new Set(eligible.map((r) => r.prefecture).filter((p): p is string => p !== null && !["東京都", "大阪府", "京都府"].includes(p)))].sort(),
  blockerReasons: count(rows.flatMap((r) => r.reasons)),
  locationForms: count(rows.filter((r) => r.explicitExistence).map((r) => r.locationForm)),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    generator: APPROXIMATE_REPLAY_VERSION, adr: "ADR-0017", anchorPolicy: "area-anchor-policy.v1", generatedOn: "2026-10-02",
    note: "Read-only replay of committed research. Nothing is rescued automatically; A requires every other gate already met.",
    summary,
    targets: rows.map(({ text: _text, location: _location, ...r }) => r),
  }, null, 2));
} else {
  console.log(`candidates replayed: ${summary.candidatesReplayed}`);
  console.log("categories:", summary.categories);
  console.log(`ADR-0017 removes the location blocker for ${eligible.length} targets (${summary.potentialSpotsStated} stated places)`);
  console.log("rescued now:", summary.rescuedSources);
}
