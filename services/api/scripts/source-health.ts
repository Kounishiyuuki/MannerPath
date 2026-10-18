// Explicit live, read-only audit. Only reviewed official resource URLs are requested.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync, crc32 } from "node:zlib";
import { pathToFileURL, URL } from "node:url";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { checkSourceHealth, type HealthTarget } from "../src/source-health/check.ts";
import { buildReport, jstDate, renderSummary, validateReviews, type SourceReview } from "../src/source-health/evaluate.ts";
import { checkRights, notChecked, withRights } from "../src/source-health/rights.ts";
import { ecdheAeadFetch } from "./source-health-transport.ts";
import { TAITO_ORIGINAL_DATA_URL } from "../src/pipeline/taito.ts";
import { OSAKA_DATA_URL } from "../src/pipeline/osaka-adapter.ts";
import { KOTO_DATA_URL } from "../src/pipeline/koto-adapter.ts";
import { MUSASHINO_DATA_URL } from "../src/pipeline/musashino-adapter.ts";
import { MINATO_DATA_URL } from "../src/pipeline/minato-adapter.ts";
import { KYOTO_DATA_URL } from "../src/pipeline/kyoto-adapter.ts";
import { KOMATSU_AIRPORT_PAGE_URL } from "../src/pipeline/komatsu-airport-adapter.ts";
import { CHUO_PARK_PAGE_URL } from "../src/pipeline/chuo-park-adapter.ts";
import { CHUO_PRIVATE_PAGE_URL } from "../src/pipeline/chuo-private-adapter.ts";
import { CHIYODA_PAGE_URL } from "../src/pipeline/chiyoda-adapter.ts";
import { SHIBUYA_PAGE_URL } from "../src/pipeline/shibuya-adapter.ts";
const root = new URL("../../../services/data-pipeline/fixtures/", import.meta.url);
const resources: Record<string, { filename: string; url: string }> = {
  "taito-public-smoking-areas": { filename: "20260818_koshukitsuenjo.csv", url: TAITO_ORIGINAL_DATA_URL },
  "osaka-designated-smoking-areas": { filename: "opendata_1012.csv", url: OSAKA_DATA_URL },
  "koto-station-smoking-areas": { filename: "131083_237_public_smoking_area_station.csv", url: KOTO_DATA_URL },
  "musashino-public-smoking-areas": { filename: "doc.kml", url: MUSASHINO_DATA_URL },
  "minato-designated-smoking-areas": { filename: "minatokushisetsujoho_fukugo.csv", url: MINATO_DATA_URL },
  "kyoto-public-smoking-places": { filename: "20260903_shisetsu.csv", url: KYOTO_DATA_URL },
};
// Reviewed in the repository but not deployed to production (ADR-0018 D-C page re-check). Kept out of the production
// inventory above, which only a deployment expands; monitored only with --repository-reviewed.
const repositoryReviewedResources: Record<string, { filename: string; url: string }> = {
  "hiroshima-airport-smoking-places": { filename: "hiroshima-airport-page-facts.csv", url: "https://www.hij.airport.jp/news/2025/02/terminalinfo-smokingarea.html" },
  "kochi-airport-smoking-places": { filename: "kochi-airport-page-facts.csv", url: "https://www.kochiap.co.jp/faq/" },
  "matsuyama-airport-smoking-places": { filename: "matsuyama-airport-page-facts.csv", url: "https://www.matsuyama-airport.co.jp/service/smoking.html" },
  "miyazaki-airport-smoking-places": { filename: "miyazaki-airport-page-facts.csv", url: "https://www.miyazaki-airport.co.jp/faq" },
  "oita-airport-smoking-places": { filename: "oita-airport-page-facts.csv", url: "https://www.oita-airport.jp/qa/" },
  "takamatsu-airport-smoking-places": { filename: "takamatsu-airport-page-facts.csv", url: "https://www.takamatsu-airport.com/guide/s013/" },
  "yonago-airport-smoking-places": { filename: "yonago-airport-page-facts.csv", url: "https://www.yonago-air.com/faq" },

  "komatsu-airport-smoking-places": { filename: "komatsu-airport-page-facts.csv", url: KOMATSU_AIRPORT_PAGE_URL },
  "chuo-park-smoking-places": { filename: "chuo-park-page-facts.csv", url: CHUO_PARK_PAGE_URL },
  "chuo-private-smoking-places": { filename: "chuo-private-page-facts.csv", url: CHUO_PRIVATE_PAGE_URL },
  "chiyoda-smoking-places": { filename: "chiyoda-page-facts.csv", url: CHIYODA_PAGE_URL },
  "shibuya-smoking-places": { filename: "shibuya-page-facts.csv", url: SHIBUYA_PAGE_URL },
};
// Reviewed sources with no health target, and why. Every SOURCE_ADAPTERS entry is exactly one of: deployed, repository-
// reviewed, or listed here (test/source-health-unified.test.ts), so the --repository-reviewed count is never incidental.
export const HEALTH_NOT_CONFIGURED: Record<string, string> = {
  // The CSV itself could be fingerprinted, but every target needs a human-reviewed, scoped rights contract in
  // review-metadata.json and source health never writes a baseline itself. Sendai's licence review (fixture
  // rights-review.json) has no scoped terms-page fingerprint yet; adding one is a maintainer review.
  "sendai-kaigan-park-smoking-areas": "noReviewedRightsContract",
};
// ADR-0018 page-fact sources: the reviewed scoped fact text of the official page (PROVENANCE.md of the fixture).
const PAGE_FACTS: Record<string, NonNullable<HealthTarget["pageFact"]>> = {
  "hiroshima-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "2025年2月28日（金）", "end": "[link:/news/] 一覧に戻る"}], "requiredMarkers": ["1階 国際線到着ロビー外", "2階 国際線チェックインカウンター前", "3階 展望デッキ前", "閉鎖"]}, "reviewedFingerprint": "34b51a11f9f0863c15c74fbbb69c390f84528d8fc3ce7662e69ef8dae225fa03"},
  "kochi-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "喫煙場所はありますか？", "end": "空港近くのホテルを教えてください。"}], "requiredMarkers": ["2F搭乗待合室内", "池の横"]}, "reviewedFingerprint": "b9dc5a0dabbba3a7e71d266d57cad36ffc0fe5814c237e826a9352fb59457ade"},
  "matsuyama-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "その他の施設 喫煙所 2F 屋外", "end": "フロアガイド [img:喫煙所の1階のフロアガイド]"}], "requiredMarkers": ["国内線2F出発ロビー", "国内線2F搭乗待合室内", "国際線2F搭乗待合室内", "ターミナルビル東側", "国際線到着ロビー出入口側"]}, "reviewedFingerprint": "a142bf657a403a08a4d496bcec7b259168f1ecfb5fd0b26c3d4356e5432d17ec"},
  "miyazaki-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "喫煙コーナーはありますか？", "end": "授乳室はありますか？"}], "requiredMarkers": ["1階航空会社カウンター前", "2階待合室内"]}, "reviewedFingerprint": "35b9b6bb1793e8a05480bfe87055c90b8446c6c91bd8725d924fef2a5c58f953"},
  "oita-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "※館内の喫煙コーナーはどこにありますか?", "end": "※空港から荷物を送りたいのですが?"}], "requiredMarkers": ["旅客ビル北側", "搭乗待合室内"]}, "reviewedFingerprint": "df09f30339c6d60437716ccc308555f4a9f7d5062b10d5b856ad26a6aee301e3"},
  "takamatsu-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "設置場所", "end": "[img:] 喫煙室 [img:] フロアマップ・空港サービス"}], "requiredMarkers": ["ターミナル中央", "国際線出発ロビー", "国内線搭乗待合室"]}, "reviewedFingerprint": "6c2eaf238c545c3d606422828dcdfdaef383ec31d63b531f93b9c3315fa5610d"},
  "yonago-airport-smoking-places": {"scope": {"kind": "htmlText", "ranges": [{"start": "喫煙所はありますか？", "end": "郵便局はありますか？"}], "requiredMarkers": ["中央出入口付近", "2階搭乗待合室内"]}, "reviewedFingerprint": "3af366410b4e3b14de5e04d88e46a6a82c7ee84667c2e801b1eff6238787a078"},

  "komatsu-airport-smoking-places": {
    scope: { kind: "htmlText", ranges: [{ start: "[img:] 喫煙場所はどこですか。", end: "関連リンク" }], requiredMarkers: ["喫煙場所", "国際線２F出発ロビー", "バス乗り場付近"] },
    reviewedFingerprint: "e5fc9afb22df6e75a9d3b721c20b34d268443d073bc3d7df4f3223bb5b1f91c6",
  },
  "chuo-park-smoking-places": {
    scope: { kind: "htmlText", ranges: [{ start: "区営指定喫煙場所 1.楓川久安橋公園", end: "民間指定喫煙場所 1." }],
      requiredMarkers: ["楓川久安橋公園", "数寄屋橋公園", "楓川新富橋公園", "5.築地川公園", "築地川亀井橋公園", "築地川銀座公園", "築地川千代橋公園（東側）", "築地川千代橋公園（西側）", "楓川弾正橋公園", "地蔵橋公園", "蛎殻町公園", "浜町公園", "佃公園", "石川島公園（中央大橋側）", "石川島公園（相生橋側）", "新月島公園"] },
    reviewedFingerprint: "08010a782b9a99d16fe3fbf46ba05432c09f7016fb2f3dc2aa3bec420b85ae67",
  },
  // The whole private list, so a new 休止 note, a removal or a changed address/hours on any listed place needs re-review.
  "chuo-private-smoking-places": {
    scope: { kind: "htmlText", ranges: [{ start: "民間指定喫煙場所 1.八重洲地下街", end: "お問い合わせ先 中央区保健所生活衛生課" }],
      requiredMarkers: ["八重洲地下街（サウステラス）", "TOFROM YAESU TOWER", "晴海客船ターミナル", "paspa小舟町"] },
    reviewedFingerprint: "9edab2d60b64c735c5468aaeb9a18dcaab7aeac9cf9701c74859d91a01ab9423",
  },
  // The whole list (区営 and 助成施設) through the page's definition of 助成施設, so a suspension note anywhere re-opens review.
  "chiyoda-smoking-places": {
    scope: { kind: "htmlText", ranges: [{ start: "秋葉原駅エリア 芳林公園喫煙所（区営）", end: "すべて助成施設となります。" }],
      requiredMarkers: ["Smoking Place 木倉食品", "paspa秋葉原高架下", "AKIBA BREATH", "スモーキングプレイス・マツイ", "paspa内神田", "smoking room ohira", "神田駅西口商店街喫煙所", "セブン-イレブン神田駅西口通り店内喫煙所", "スモーキングスペース TeeTime", "paspa鍛冶町", "paspa小伝馬町", "THE TOBACCO IWAMOTOCHO", "paspa東神田", "朝陽ビル無料公衆喫煙所", "ヒライ商会", "Smo9 o2", "Smoking Room 九段北店", "九段会館テラス地下1階喫煙所", "paspa飯田橋西口", "paspa飯田橋東口", "ピュアウッドガーデン", "THE TOBACCO IIDABASHI", "一服（Ippuku）平河町店", "paspa 永田町", "三久ビル喫煙所", "paspa霞が関", "THE TABACCO 2:50.76", "THE TOBACCO HIBIYA", "paspa市ヶ谷", "喜助お茶の水ビル喫煙所", "paspa西神田"] },
    reviewedFingerprint: "0e14537fd9368f9bcda25a69d11ddf0a34e58e3369fbd9c5e97cbd264b72f461",
  },
  // The whole list from the ward's closure notice through its last listed place, so a new 休止/閉鎖 note re-opens review.
  "shibuya-smoking-places": {
    scope: { kind: "htmlText", ranges: [{ start: "台風や大雪などの気象状況により", end: "環境整備課きれいなまちづくり係" }],
      requiredMarkers: ["代々木駅東口喫煙所", "代々木駅西口喫煙所", "代々木二丁目あおい公園喫煙所", "神南1丁目香取屋ビル西側喫煙所", "paspa宮益坂", "クランクストリート加熱式たばこ喫煙所", "THE TOBACCO SHIBUYA SECOND", "THE TOBACCO DOGENZAKA", "THE TOBACCO DOGENZAKA SECOND", "THE TOBACCO AOYAMA", "ファミリーマート神宮前三丁目店喫煙所", "もこのたばこ（旧瀧島たばこ店）喫煙所", "渋谷キャスト", "渋谷ストリーム", "渋谷ソラスタ", "ラ・トゥール渋谷宇田川Abema Towers", "渋谷パルコ", "渋谷フクラス", "MIYASHITA PARK", "道玄坂通 dogenzaka-dori", "渋谷アクシュ", "関電不動産渋谷ビル", "BASE 1", "表参道ヒルズ", "WITH HARAJUKU", "東急プラザ原宿「ハラカド」", "アパホテル&リゾート西新宿五丁目タワー", "タイムズスクエアビル", "リンクスクエア新宿", "住友不動産新宿南口ビル", "ヒューリック将棋会館千駄ヶ谷ビル"] },
    reviewedFingerprint: "58e83b254ef67b8e1823fd389454d6a3a1e6d0e9a266d0b79b811117ef016b43",
  },
};
// Read ZIP central directory rather than trusting local headers/data descriptors. No files are written.
export function archiveMember(bytes: Uint8Array, suffix: string): Uint8Array {
  const buffer = Buffer.from(bytes); const limit = 5_000_000;
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error("unsupported ZIP");
  const count = buffer.readUInt16LE(end + 10); let position = buffer.readUInt32LE(end + 16);
  const matches: Uint8Array[] = [];
  if (count > 100) throw new Error("archive member limit");
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(position) !== 0x02014b50) throw new Error("invalid central directory");
    const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10);
    const compressed = buffer.readUInt32LE(position + 20), expanded = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28), extra = buffer.readUInt16LE(position + 30), comment = buffer.readUInt16LE(position + 32);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString("latin1");
    if (name.endsWith(suffix)) {
      if (matches.length !== 0) throw new Error("duplicate archive member");
      if (flags & 1 || expanded > limit || compressed > limit) throw new Error("unsafe archive member");
      const local = buffer.readUInt32LE(position + 42);
      if (buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 8) !== method || buffer.readUInt16LE(local + 6) !== flags) throw new Error("invalid local header");
      const localNameLength = buffer.readUInt16LE(local + 26);
      if (!buffer.subarray(local + 30, local + 30 + localNameLength).equals(buffer.subarray(position + 46, position + 46 + nameLength))) throw new Error("local name mismatch");
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      if (start + compressed > buffer.length) throw new Error("truncated ZIP");
      const data = buffer.subarray(start, start + compressed);
      const output = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: limit }) : null;
      if (!output || output.length !== expanded || crc32(output) !== buffer.readUInt32LE(position + 16)) throw new Error("unsupported or invalid archive member");
      matches.push(output);
    }
    position += 46 + nameLength + extra + comment;
  }
  if (matches.length !== 1) throw new Error("expected exactly one archive member");
  return matches[0];
}
export function productionHealthTargets(): HealthTarget[] {
  // Production monitoring has an explicit inventory; repository onboarding alone never expands it.
  return healthTargets(resources);
}
/** The deployed inventory plus every repository-reviewed source that has health configured (see HEALTH_NOT_CONFIGURED). */
export function repositoryReviewedHealthTargets(): HealthTarget[] {
  const targets = healthTargets({ ...resources, ...repositoryReviewedResources });
  const ids = targets.map(target => target.adapter.registry.sourceId);
  for (const { registry: { sourceId } } of SOURCE_ADAPTERS) {
    if (ids.includes(sourceId) === sourceId in HEALTH_NOT_CONFIGURED)
      throw new Error(`Reviewed source ${sourceId} must be either a health target or in HEALTH_NOT_CONFIGURED, exactly one`);
  }
  return targets;
}
function healthTargets(inventory: Record<string, { filename: string; url: string }>): HealthTarget[] {
  return Object.entries(inventory).map(([sourceId, resource]) => {
    const adapter = SOURCE_ADAPTERS.find(candidate => candidate.registry.sourceId === sourceId);
    if (!adapter) throw new Error(`Production health inventory needs reviewed adapter: ${sourceId}`);
    const directory = new URL(`${adapter.registry.sourceId}/`, root);
    const fixture = new Uint8Array(readFileSync(new URL(resource.filename, directory)));
    const target: HealthTarget = { adapter, url: resource.url,
      baselineSha256: createHash("sha256").update(fixture).digest("hex"), baselineHeader: adapter.parse(fixture).header,
      mimeTypes: ["text/csv", "application/csv", "application/octet-stream", "application/vnd.ms-excel", "text/plain", "text/comma-separated-values"] };
    if (adapter.registry.sourceId === "musashino-public-smoking-areas") {
      target.baselineResourceSha256 = JSON.parse(readFileSync(new URL("fetch.json", directory), "utf8")).archiveSha256;
      target.mimeTypes = ["application/zip", "application/x-zip-compressed", "application/octet-stream"];
      target.prepare = bytes => archiveMember(archiveMember(bytes, ".kmz"), "doc.kml");
    }
    const pageFact = PAGE_FACTS[adapter.registry.sourceId];
    if (pageFact) { target.pageFact = pageFact; target.mimeTypes = ["text/html"]; }
    if (adapter.registry.sourceId === "kyoto-public-smoking-places") {
      target.mimeTypes = [...target.mimeTypes, "application/force-download"];
      target.request = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ upload_file: "20260903182354_data（令和8年9月3日現在）.csv", download: "このデータをダウンロード" }).toString() };
    }
    return target;
  }).sort((a, b) => a.adapter.registry.sourceId.localeCompare(b.adapter.registry.sourceId));
}
// Only Osaka's mapnavi data host prefers 1024-bit DHE (see source-health-transport.ts). The narrower transport
// is scoped to exactly that source, request kind and hostname; rights pages and every other source keep
// Node's default fetch.
type Transport = { name: string; fetch: (url: string, init?: RequestInit) => Promise<Response> };
const DEFAULT_TRANSPORT: Transport = { name: "node-fetch", fetch: (url, init) => fetch(url, init) };
export function liveTransport(sourceId: string, kind: "data" | "rights", url: string): Transport {
  return sourceId === "osaka-designated-smoking-areas" && kind === "data" && new URL(url).hostname === "www.mapnavi.city.osaka.lg.jp"
    ? { name: "node-https-ecdhe-aead", fetch: ecdheAeadFetch } : DEFAULT_TRANSPORT;
}
export function sourceReviews(): SourceReview[] {
  return JSON.parse(readFileSync(new URL("../../data-pipeline/source-health/review-metadata.json", import.meta.url), "utf8")).sources;
}
// Offline replay: serves the reviewed fixtures (Musashino: the reviewed outer archive) through the same
// checker and evaluator. No network; rights pages are reported as notChecked.
function offlineFetch(targets: HealthTarget[]): (url: string) => Promise<Response> {
  return async url => {
    const target = targets.find(t => t.url === url);
    if (!target) throw new Error("offline mode refuses network access");
    const resource = { ...resources, ...repositoryReviewedResources }[target.adapter.registry.sourceId];
    const file = target.baselineResourceSha256 ? "toilet.zip" : resource.filename;
    const bytes = readFileSync(new URL(`${target.adapter.registry.sourceId}/${file}`, root));
    return new Response(bytes, { status: 200, headers: { "content-type": target.mimeTypes[0] } });
  };
}
// Offline, a page-fact source's page is not available (its HTML is never committed): probe only the reviewed fact sheet
// through the adapter and say so; the page itself is checked only live.
async function offlinePageFact(target: HealthTarget) {
  const probe: HealthTarget = { ...target, pageFact: undefined, mimeTypes: ["text/csv"] };
  const health = await checkSourceHealth(probe, { fetch: offlineFetch([probe]) });
  health.pageFactNotChecked = true;
  health.notes.push("Offline: the official page was not fetched; only the reviewed fact sheet was probed");
  return health;
}
const STDIO = { out: (text: string) => void process.stdout.write(text), err: (text: string) => void process.stderr.write(text) };
export async function main(args: string[] = process.argv.slice(2), now = new Date(), io = STDIO) {
  const mode = args.filter(arg => arg === "--live" || arg === "--offline");
  if (args.some(arg => arg !== "--live" && arg !== "--offline" && arg !== "--repository-reviewed" && !arg.startsWith("--source=")) || mode.length !== 1)
    throw new Error("Usage: npm run source:health -- (--live | --offline) [--repository-reviewed] [--source=source-id]");
  const live = mode[0] === "--live";
  const ids = args.filter(arg => arg.startsWith("--source=")).map(arg => arg.slice(9));
  const targets = args.includes("--repository-reviewed") ? repositoryReviewedHealthTargets() : productionHealthTargets();
  if (ids.some(id => !targets.some(t => t.adapter.registry.sourceId === id))) throw new Error("Unknown reviewed source id");
  const reviews = sourceReviews();
  // The metadata covers every health-configured source, deployed or repository-reviewed, exactly once.
  validateReviews(reviews, repositoryReviewedHealthTargets().map(t => t.adapter.registry.sourceId));
  // Sequential and exhaustive: every source (data and rights pages) is checked and reported even when
  // another fails; the exit code is decided only afterwards.
  const results = [];
  for (const target of targets.filter(t => !ids.length || ids.includes(t.adapter.registry.sourceId))) {
    const sourceId = target.adapter.registry.sourceId;
    const transport = live ? liveTransport(sourceId, "data", target.url) : { name: "offline-fixture", fetch: offlineFetch(targets) };
    const health = !live && target.pageFact ? await offlinePageFact(target) : await checkSourceHealth(target, { fetch: transport.fetch });
    const contracts = reviews.find(review => review.sourceId === sourceId)!.rights;
    const rights = [];
    for (const contract of contracts) rights.push(live ? await checkRights(contract, { fetch: liveTransport(sourceId, "rights", contract.url).fetch }) : notChecked(contract));
    results.push({ ...withRights(health, rights), transport: transport.name });
  }
  const report = buildReport(results, reviews, jstDate(now));
  io.out(JSON.stringify(report, null, 2) + "\n");
  io.err(renderSummary(report));
  process.exitCode = report.exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 2; });
