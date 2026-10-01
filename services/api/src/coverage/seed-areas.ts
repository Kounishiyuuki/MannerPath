// Seed areas for community collection (ADR-0013): where asking people to look is most worth it. This is a COLLECTION
// PRIORITY list, never smoking-place data: no entry says or implies that a smoking place exists there, nothing here is
// ever published as a spot, and no entry is evidence for anything.
//
// Centres are hand-entered, approximate (two decimals, roughly ±500 m) public knowledge of where a station, airport or
// district is. They are good enough to say "information around here is thin" and nothing finer, which is also why
// gap tasks use SEED_RADIUS_METRES rather than a station-exit precision radius. A licensed station reference dataset
// (BETA_DATA_QUALITY: top 50 / top 300 stations) would replace the station entries once reviewed.
//
// `priority` is an ordered campaign tier, not a score: 1 = national hubs, 2 = prefectural main stations and airports,
// 3 = other districts.

import type { PrefectureCode } from "./prefectures.ts";
import { CAMPAIGN_AREAS } from "./campaign-areas.ts";

export const SEED_AREAS_VERSION = "seed-areas.v1";
export const SEED_RADIUS_METRES = 1000;

export type SeedKind = "majorStation" | "airport" | "downtown" | "nightlife" | "touristHub" | "university" | "officialLead";

export interface SeedArea {
  id: string;
  name: string;
  prefecture: PrefectureCode;
  kind: SeedKind;
  priority: 1 | 2 | 3;
  latitude: number;
  longitude: number;
}

const s = (id: string, name: string, prefecture: PrefectureCode, kind: SeedKind, priority: 1 | 2 | 3, latitude: number, longitude: number): SeedArea =>
  ({ id, name, prefecture, kind, priority, latitude, longitude });

export const SEED_AREAS: readonly SeedArea[] = [
  // National hubs (tier 1).
  s("tokyo-shinjuku", "新宿駅・歌舞伎町周辺", "13", "majorStation", 1, 35.69, 139.70),
  s("tokyo-shibuya", "渋谷駅周辺", "13", "majorStation", 1, 35.66, 139.70),
  s("tokyo-ikebukuro", "池袋駅周辺", "13", "majorStation", 1, 35.73, 139.71),
  s("tokyo-tokyo", "東京駅周辺", "13", "majorStation", 1, 35.68, 139.77),
  s("tokyo-shinagawa", "品川駅周辺", "13", "majorStation", 1, 35.63, 139.74),
  s("tokyo-ueno", "上野駅周辺", "13", "majorStation", 1, 35.71, 139.78),
  s("tokyo-shimbashi", "新橋駅周辺", "13", "downtown", 1, 35.67, 139.76),
  s("kanagawa-yokohama", "横浜駅周辺", "14", "majorStation", 1, 35.47, 139.62),
  s("saitama-omiya", "大宮駅周辺", "11", "majorStation", 1, 35.91, 139.62),
  s("aichi-nagoya", "名古屋駅周辺", "23", "majorStation", 1, 35.17, 136.88),
  s("aichi-sakae", "栄周辺", "23", "downtown", 1, 35.17, 136.91),
  s("osaka-umeda", "大阪・梅田駅周辺", "27", "majorStation", 1, 34.70, 135.50),
  s("osaka-namba", "なんば・道頓堀周辺", "27", "nightlife", 1, 34.67, 135.50),
  s("kyoto-kyoto", "京都駅周辺", "26", "majorStation", 1, 34.99, 135.76),
  s("hyogo-sannomiya", "三宮駅周辺", "28", "majorStation", 1, 34.69, 135.20),
  s("fukuoka-hakata", "博多駅周辺", "40", "majorStation", 1, 33.59, 130.42),
  s("fukuoka-tenjin", "天神・中洲周辺", "40", "nightlife", 1, 33.59, 130.40),
  s("hokkaido-sapporo", "札幌駅周辺", "01", "majorStation", 1, 43.07, 141.35),
  s("hokkaido-susukino", "すすきの周辺", "01", "nightlife", 1, 43.06, 141.35),
  s("miyagi-sendai", "仙台駅周辺", "04", "majorStation", 1, 38.26, 140.88),
  s("hiroshima-hiroshima", "広島駅周辺", "34", "majorStation", 1, 34.40, 132.48),
  // Airports (tier 2).
  s("tokyo-haneda", "羽田空港", "13", "airport", 2, 35.55, 139.78),
  s("chiba-narita", "成田空港", "12", "airport", 2, 35.77, 140.39),
  s("osaka-kansai", "関西国際空港", "27", "airport", 2, 34.43, 135.23),
  s("aichi-chubu", "中部国際空港", "23", "airport", 2, 34.86, 136.81),
  s("hokkaido-new-chitose", "新千歳空港", "01", "airport", 2, 42.79, 141.68),
  s("fukuoka-airport", "福岡空港", "40", "airport", 2, 33.59, 130.45),
  s("okinawa-naha-airport", "那覇空港", "47", "airport", 2, 26.21, 127.65),
  // Tourist hubs (tier 2).
  s("tokyo-asakusa", "浅草周辺", "13", "touristHub", 2, 35.71, 139.80),
  s("kyoto-shijo", "四条河原町・祇園周辺", "26", "touristHub", 2, 35.00, 135.77),
  s("okinawa-kokusai", "国際通り周辺", "47", "touristHub", 2, 26.21, 127.68),
  // Prefectural main stations (tier 2) — one per prefecture not named above.
  s("aomori-aomori", "青森駅周辺", "02", "majorStation", 2, 40.83, 140.73),
  s("iwate-morioka", "盛岡駅周辺", "03", "majorStation", 2, 39.70, 141.14),
  s("akita-akita", "秋田駅周辺", "05", "majorStation", 2, 39.72, 140.13),
  s("yamagata-yamagata", "山形駅周辺", "06", "majorStation", 2, 38.25, 140.33),
  s("fukushima-koriyama", "郡山駅周辺", "07", "majorStation", 2, 37.40, 140.39),
  s("ibaraki-mito", "水戸駅周辺", "08", "majorStation", 2, 36.37, 140.48),
  s("tochigi-utsunomiya", "宇都宮駅周辺", "09", "majorStation", 2, 36.56, 139.90),
  s("gunma-takasaki", "高崎駅周辺", "10", "majorStation", 2, 36.32, 139.01),
  s("chiba-chiba", "千葉駅周辺", "12", "majorStation", 2, 35.61, 140.11),
  s("niigata-niigata", "新潟駅周辺", "15", "majorStation", 2, 37.91, 139.06),
  s("toyama-toyama", "富山駅周辺", "16", "majorStation", 2, 36.70, 137.21),
  s("ishikawa-kanazawa", "金沢駅周辺", "17", "majorStation", 2, 36.58, 136.65),
  s("fukui-fukui", "福井駅周辺", "18", "majorStation", 2, 36.06, 136.22),
  s("yamanashi-kofu", "甲府駅周辺", "19", "majorStation", 2, 35.67, 138.57),
  s("nagano-nagano", "長野駅周辺", "20", "majorStation", 2, 36.64, 138.19),
  s("gifu-gifu", "岐阜駅周辺", "21", "majorStation", 2, 35.41, 136.76),
  s("shizuoka-shizuoka", "静岡駅周辺", "22", "majorStation", 2, 34.97, 138.39),
  s("shizuoka-hamamatsu", "浜松駅周辺", "22", "majorStation", 3, 34.70, 137.73),
  s("mie-yokkaichi", "四日市駅周辺", "24", "majorStation", 2, 34.97, 136.62),
  s("shiga-kusatsu", "草津駅周辺", "25", "majorStation", 2, 35.02, 135.96),
  s("nara-nara", "奈良駅周辺", "29", "majorStation", 2, 34.68, 135.82),
  s("wakayama-wakayama", "和歌山駅周辺", "30", "majorStation", 2, 34.23, 135.19),
  s("tottori-tottori", "鳥取駅周辺", "31", "majorStation", 2, 35.49, 134.23),
  s("shimane-matsue", "松江駅周辺", "32", "majorStation", 2, 35.46, 133.06),
  s("okayama-okayama", "岡山駅周辺", "33", "majorStation", 2, 34.67, 133.92),
  s("yamaguchi-shin-yamaguchi", "新山口駅周辺", "35", "majorStation", 2, 34.09, 131.40),
  s("tokushima-tokushima", "徳島駅周辺", "36", "majorStation", 2, 34.07, 134.55),
  s("kagawa-takamatsu", "高松駅周辺", "37", "majorStation", 2, 34.35, 134.05),
  s("ehime-matsuyama", "松山駅周辺", "38", "majorStation", 2, 33.84, 132.75),
  s("kochi-kochi", "高知駅周辺", "39", "majorStation", 2, 33.57, 133.54),
  s("saga-saga", "佐賀駅周辺", "41", "majorStation", 2, 33.26, 130.30),
  s("nagasaki-nagasaki", "長崎駅周辺", "42", "majorStation", 2, 32.75, 129.87),
  s("kumamoto-kumamoto", "熊本駅周辺", "43", "majorStation", 2, 32.79, 130.69),
  s("oita-oita", "大分駅周辺", "44", "majorStation", 2, 33.23, 131.61),
  s("miyazaki-miyazaki", "宮崎駅周辺", "45", "majorStation", 2, 31.92, 131.43),
  s("kagoshima-chuo", "鹿児島中央駅周辺", "46", "majorStation", 2, 31.58, 130.54),
  // Universities (tier 3).
  s("tokyo-hongo", "本郷・東京大学周辺", "13", "university", 3, 35.71, 139.76),
  s("kyoto-yoshida", "京都大学吉田周辺", "26", "university", 3, 35.03, 135.78),
  ...CAMPAIGN_AREAS,
];
