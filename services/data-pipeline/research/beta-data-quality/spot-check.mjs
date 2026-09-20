// Independent spot check of the published corpus against 台東区's *current* official material
// (Issue #33, docs/BETA_DATA_QUALITY.md §"Manual official-source spot check").
//
// It compares three things that are supposed to agree and regularly do not:
//   1. the committed fixture  vs  the release file the ward serves right now (byte comparison);
//   2. every fixture record   vs  the ward's 公衆喫煙所ウェブマップ・一覧 HTML page, which is a
//      different publication of the same list and carries qualifiers the CSV does not have;
//   3. the CSV's own row order vs the page's, because `#` is not a stable identifier (research §7).
//
// Network only; it reads no database and writes nothing. Output is a JSON report on stdout.
//
//   node services/data-pipeline/research/beta-data-quality/spot-check.mjs
import { createHash } from "node:crypto";

const CSV_URL = "https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv";
const CATALOG_URL = "https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html";
const LIST_URL = "https://www.city.taito.lg.jp/kenchiku/machibika/kosyu/webmap.html";
// The fixture this repository imports. Checked as bytes, so a silent re-release is detected.
const FIXTURE = new URL("../../fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url);

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return { body: new Uint8Array(await res.arrayBuffer()), lastModified: res.headers.get("last-modified") };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decode = (bytes) => new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");

/** Minimal RFC 4180 reader: the file has quoted fields with embedded newlines. */
function parseCsv(input) {
  const rows = [[""]];
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const row = rows[rows.length - 1];
    if (quoted) {
      if (c !== '"') row[row.length - 1] += c;
      else if (input[i + 1] === '"') { row[row.length - 1] += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push("");
    else if (c === "\r") continue;
    else if (c === "\n") rows.push([""]);
    else row[row.length - 1] += c;
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

/** The ward's list page, as one flat array of cell texts; enough to find a name and its hours. */
function pageCells(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<\/t[dh]>/g, "\u0001")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .split("\u0001").map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s !== "");
}

/** Compares names across two publications that punctuate differently (セブン-イレブン／セブンイレブン). */
const key = (s) => s.normalize("NFKC").replace(/[\s　・\-－―ー'"'"（）()]/g, "").toLowerCase();

const [csv, page, catalog] = await Promise.all([text(CSV_URL), text(LIST_URL), text(CATALOG_URL)]);
const fixture = new Uint8Array(await (await import("node:fs/promises")).readFile(FIXTURE));

const records = parseCsv(decode(csv.body)).slice(1);
const cells = pageCells(decode(page.body));
const catalogText = decode(catalog.body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const findings = [];
for (const r of records) {
  const [ordinal, , , name, , , , start, end, , , note] = r;
  // The two publications write the same place differently (清川清掃車庫内／清川清掃車庫), so a
  // prefix match in either direction counts as the same record and the difference is reported.
  const at = cells.findIndex((c) => key(c).startsWith(key(name)) || key(name).startsWith(key(c)));
  if (at === -1) {
    findings.push({ ordinal, name, kind: "not-on-list-page" });
    continue;
  }
  const nameDiffers = cells[at] !== name;
  // On the page a row is 番号 / 名称 / 所在地 / 運営時間: the hours cell follows the address cell.
  const listedHours = cells[at + 2] ?? "";
  const csvHours = start === "終日利用可能" && end === "終日利用可能" ? "終日" : `${start}-${end}`;
  const pageOrdinal = cells[at - 1];
  // Midnight is written 0:00 in the CSV and 24:00 on the page; the resolver already treats a
  // closing 0:00 as 24:00, so the two spellings are the same closing time, not a discrepancy.
  const digits = (s) => (s.normalize("NFKC").match(/\d{1,2}[:：]\d{2}/g) ?? [])
    .map((t) => t.replace("：", ":").replace(/^0:00$/, "24:00").replace(/^(\d):/, "0$1:")).join("-");
  const hoursAgree = listedHours.includes("終日") ? csvHours === "終日" : digits(listedHours) === digits(csvHours);
  // A qualifier the page states and the CSV does not is what turns a parsed openingHours into a
  // claim the source does not support, so it is reported even when the clock times agree.
  const qualifierOnPageOnly = /[※(（]|除く|のみ|閉鎖|運休|休業|移転/.test(listedHours) && note.trim() === "";
  if (!hoursAgree || qualifierOnPageOnly || pageOrdinal !== ordinal || nameDiffers) {
    findings.push({
      ordinal, name, pageOrdinal, listedName: cells[at], csvHours, csvNote: note.trim(), listedHours,
      kind: [!hoursAgree && "hours-differ", qualifierOnPageOnly && "qualifier-only-on-list-page",
        pageOrdinal !== ordinal && "ordinal-differs", nameDiffers && "name-differs"].filter(Boolean).join(","),
    });
  }
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  releaseFile: { url: CSV_URL, sha256: sha256(csv.body), bytes: csv.body.length, httpLastModified: csv.lastModified },
  fixture: { sha256: sha256(fixture), bytes: fixture.length, identicalToLiveRelease: sha256(fixture) === sha256(csv.body) },
  catalogPage: {
    url: CATALOG_URL,
    stillLabels20260818: catalogText.includes("公衆喫煙所（令和8年8月18日時点）"),
    stillStatesCcBy: catalogText.includes("クリエイティブ・コモンズ 表示 4.0 国際"),
  },
  listPage: { url: LIST_URL, asOfLabelPresent: cells.some((c) => c.includes("令和8年8月18日現在")) },
  sampleMethod: "census: all 34 CSV records compared with the ward's list page",
  sampleSize: records.length,
  findings,
}, null, 2));
