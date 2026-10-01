// The 47 prefectures (JIS X 0401 codes) and the one reviewed way a published spot is assigned to one today.
//
// MannerPath has no reviewed administrative-boundary dataset yet (国土数値情報 N03 needs a license review, BETA_DATA_QUALITY),
// so assignment is by evidence, never by a guessed polygon:
//   - an official/operator spot belongs to the prefecture of its source's jurisdiction (SOURCE_PREFECTURES, reviewed
//     with each source);
//   - a community spot belongs to a seed area's prefecture only when it lies within SEED_ASSIGNMENT_METRES of that seed
//     area's centre (method `seedArea`, approximate); otherwise it is counted as `unassigned`, never placed by guess.

import { COMMUNITY_SOURCE_ID } from "../pipeline/community-adapter.ts";

export const PREFECTURES = [
  ["01", "北海道"], ["02", "青森県"], ["03", "岩手県"], ["04", "宮城県"], ["05", "秋田県"], ["06", "山形県"], ["07", "福島県"],
  ["08", "茨城県"], ["09", "栃木県"], ["10", "群馬県"], ["11", "埼玉県"], ["12", "千葉県"], ["13", "東京都"], ["14", "神奈川県"],
  ["15", "新潟県"], ["16", "富山県"], ["17", "石川県"], ["18", "福井県"], ["19", "山梨県"], ["20", "長野県"], ["21", "岐阜県"],
  ["22", "静岡県"], ["23", "愛知県"], ["24", "三重県"], ["25", "滋賀県"], ["26", "京都府"], ["27", "大阪府"], ["28", "兵庫県"],
  ["29", "奈良県"], ["30", "和歌山県"], ["31", "鳥取県"], ["32", "島根県"], ["33", "岡山県"], ["34", "広島県"], ["35", "山口県"],
  ["36", "徳島県"], ["37", "香川県"], ["38", "愛媛県"], ["39", "高知県"], ["40", "福岡県"], ["41", "佐賀県"], ["42", "長崎県"],
  ["43", "熊本県"], ["44", "大分県"], ["45", "宮崎県"], ["46", "鹿児島県"], ["47", "沖縄県"],
] as const;
export type PrefectureCode = (typeof PREFECTURES)[number][0];

/** The jurisdiction of every reviewed official source (docs/SOURCES.md). A new source adds its row here when reviewed. */
export const SOURCE_PREFECTURES: Readonly<Record<string, PrefectureCode>> = {
  "taito-public-smoking-areas": "13",
  "minato-designated-smoking-areas": "13",
  "koto-station-smoking-areas": "13",
  "musashino-public-smoking-areas": "13",
  "osaka-designated-smoking-areas": "27",
  "kyoto-public-smoking-places": "26",
};

/** Community sources have no jurisdiction; their spots are assigned through seed areas or not at all. */
export const SOURCES_WITHOUT_JURISDICTION: readonly string[] = [COMMUNITY_SOURCE_ID];

export const SEED_ASSIGNMENT_METRES = 1000;
