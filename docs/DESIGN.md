# MannerPath Design — Apple-native UI specification

Status: **Draft 2026-10-06.** UI design target for iPhone, Apple Watch and widgets. This document translates the
Stitch design project into Apple-native SwiftUI / MapKit / WidgetKit decisions. It does not change data, evidence or
privacy rules: where it touches them it defers to `docs/SPECIFICATION.md`, ADR-0001, ADR-0004, ADR-0006, ADR-0012,
ADR-0013 and ADR-0017. When this file and those documents disagree, they win and this file must be corrected.

No Swift code is changed by this document. "Required change" rows describe future work, ordered in
[Implementation order](#implementation-order).

## 1. Source of the design

| Item | Value (read from Stitch MCP, 2026-10-06) |
| --- | --- |
| Stitch project | **MannerPath iOS Map Interface** |
| Project ID | `3608323333557970571` (`projects/3608323333557970571`) |
| Device type | `MOBILE`; project type `TEXT_TO_UI_PRO` |
| Screens returned by `list_screens` | 25 (24 mobile mockups + 1 Markdown spec, "MannerPath Apple Platform Native Design Spec") |
| Design system | "MannerPath Native Spatial Utility" (project `designTheme.designMd`) |

Stitch screens, grouped by surface. Stitch has no explicit iPhone/Watch/Widget field; the grouping below comes from
the screen titles.

| Surface | Stitch screen title | Screen ID |
| --- | --- | --- |
| iPhone | MannerPath - 通常探索画面 | `ab6cd7c5eda645d69cb3043c49a55cf5` |
| iPhone | MannerPath - 地点選択状態 | `4ba0766c8f3943c8b82be2fd29b1992b` |
| iPhone | MannerPath - 地点詳細（公式・正確位置） | `6475359422d84f6da4186c33e150c113` |
| iPhone | MannerPath - 地点詳細（公式・概算位置） | `50f9b8ee0f8a4d56846d2344972794a0` |
| iPhone | MannerPath - 地点詳細（利用者報告・未確認） | `3e167501528d4936898c836161385ce9` |
| iPhone | MannerPath - 地点詳細（鮮度警告・過去データ） | `841c07ce21bd46c9b31b6f946a5eb837` |
| iPhone | MannerPath - 地点詳細（ダークモード） | `14c26c24c3354ac298104f5cef47f45f` |
| iPhone | MannerPath - フィルタ画面 | `3c7960c8213149dc826110e297085ef8` |
| iPhone | MannerPath - 場所追加 Step 1（重複候補表示） | `02f5141e802647869f5960edaa1c17a2` |
| iPhone | MannerPath - 場所追加 Step 2（詳細入力） | `94674f355a64465a9f7e903cf15336ae` |
| iPhone | MannerPath - 場所追加 Step 3（規約同意・確認） | `1e4c6dc35acd44b7b29d2c57a09c5735` |
| iPhone | MannerPath - 状態1: 公開済みデータなし | `78c19a9733894da0a65c2d5ba6019284` |
| iPhone | MannerPath - 状態2: 位置情報未許可 | `21e3fcbb794a44d3a52bea68538fd301` |
| iPhone | MannerPath - 状態3: 位置取得失敗 | `ef7c4e9819f0439ab7587f813aa29c65` |
| iPhone | MannerPath - 状態4: オフライン（キャッシュ表示） | `fc6159e56e1548e8b4d5490daed92c6a` |
| iPhone | MannerPath - 状態5: オフライン（キャッシュなし） | `28429d1c0d7a4d8a822113ed6ea14430` |
| iPhone | MannerPath - 状態6: データ更新失敗 | `aa050cc695d14f4bb3302a73b5aeffef` |
| iPhone | MannerPath - 状態7: 報告機能のみ利用不可 | `9fcf874ba8824905a653e138c2db261f` |
| iPhone | MannerPath - 初回利用時の注意 | `a42fc90b375c41179fdd4f53f174614d` |
| iPhone | MannerPath - データとプライバシー | `9ffd24b0058f406280086cefc18a556f` |
| Watch | MannerPath Watch - 通常画面 | `1720de78b44d4da2a473ac4d835bff1e` |
| Watch | MannerPath Watch - 古いデータ | `d5764255ed33466c883a24ba70fd57f0` |
| Watch | MannerPath Watch - オフライン | `e0b41daf8ce547399a2ca060143c8df9` |
| Watch | MannerPath Watch - 位置情報なし | `50052f63f4bc4486b7dd636c6caa98a7` |
| Watch | MannerPath Watch - 保存データなし | `6d8f7a7f7c2b415faf46aa58181c4269` |
| Widget | MannerPath - Widget仕様（Small / Medium / Lock Screen） | `86435ec91a874c49af43bd6653302154` |
| Spec | MannerPath Apple Platform Native Design Spec (Markdown) | `5bfcfcdcf9a6413faa08797462498027` |

What Stitch does **not** provide, and this document therefore does not invent:

- No prototype / interaction links between screens were returned by the MCP. Navigation flow below is derived from
  the current app, not from Stitch.
- No Stitch screen exists for: Watch Detail, Watch Source/License, a standalone destination-search screen, an
  expanded (large-detent) nearby list, or Report Terms as its own screen. Those rows say "no Stitch target".
- Stitch tokens are web/CSS values (Inter font, rem spacing, CSS shadows, backdrop blur). They are references for
  intent, not values to copy (see §3).
- Stitch screens contain sample data (place names, counts such as 「今日確認できた (19)」, 「混雑の目安」, ratings of
  crowding, "MannerPath Trust Engine"). None of it is product data or an approved feature.

## 2. Design principles

1. **iPhone is Map-first.** A full-screen `Map` is the root; nearby results live in a native bottom sheet over it.
2. **Apple Watch is List-first.** No map on the watch; a standard `List` that can be read in one glance.
3. **System background first.** Surfaces are `systemBackground` / `secondarySystemBackground` / grouped-list
   backgrounds supplied by the system. MannerPath Yellow is an accent covering roughly **5–10 %** of a screen.
4. **Native components only.** `NavigationStack`, `.searchable`, `.toolbar`, `.sheet` +
   `presentationDetents`, `Form` / `List`, `ContentUnavailableView`, `.borderedProminent` / `.bordered`, MapKit,
   WidgetKit.
5. **Liquid Glass comes from the system.** On iOS 26 / watchOS 26 the navigation bar, toolbar, search field and
   sheets adopt Liquid Glass automatically when they are standard components. MannerPath adds no glass of its own.
   On the iOS 18 / watchOS 11 deployment floor the same code renders the previous system materials.
6. **Honest information over decoration.** Evidence, location precision and freshness are always visible and never
   expressed by colour alone.

## 3. Foundations

### 3.1 Brand — MannerPath Yellow

| Token | Light | Dark | Source |
| --- | --- | --- | --- |
| Brand yellow (Stitch `customColor` / `primary_container`) | `#F5A623` | — | Stitch design theme |
| Pressed (Stitch `overrideSecondaryColor`) | `#E69500` | — | Stitch design theme |
| Accent, dark (Stitch design system) | — | `#FFB340` | Stitch design Markdown |
| Stitch spec "accentColor" (claimed 4.8:1; measured 2.94:1 on white) — reference only, **not used for shipping text** | `#D98200` | `#F5A623` | Stitch native spec |

Decisions:

- **Global `AccentColor` stays the system tint (§9.1).** Text, SF Symbols, toolbar, navigation and links use system
  foreground / system tint colours, never yellow.
- MannerPath Yellow is a separate brand asset, `MannerPathYellow` = `#F5A623`, used only for the selected map
  marker, larger filled selected states and the primary CTA background. Content on it uses a colour with real
  contrast (black: 10.36:1); white on `#F5A623` is 2.03:1 and is not used.
- Yellow never carries meaning by itself (selection is also stated in text / VoiceOver) and stays at roughly 5–10 %
  of a screen. It is **not** for backgrounds, cards, list rows, evidence state or text.
- Contrast measured with the WCAG 2 relative-luminance formula (2026-10-06): `#D98200` on white 2.94:1, on
  `#F2F2F7` 2.63:1 — below 4.5:1 for text, so `#D98200` is not a text-safe token. `#F5A623` on `#1C1C1E` 8.39:1.
- The Stitch Material-style palette (`primary #835500`, `tertiary #006e28`, `surface #faf9fe`, …) is not used; system
  colours replace it.

### 3.2 Light / Dark

- All surfaces and labels use semantic system colours (`.background`, `.secondary`, `Color(.secondarySystemBackground)`,
  `.separator`), so light and dark follow the system. Stitch's light/dark tables match the iOS system values and
  are only a reference.
- The Stitch dark-mode detail screen (`14c26c24…`) is the reference for dark: same layout, system dark backgrounds,
  brighter accent.
- No forced `colorScheme`, no custom dark palette.

### 3.3 Typography

- Use SwiftUI text styles (`.largeTitle` … `.caption2`) with the system font (SF Pro / Hiragino Sans). Stitch's
  `Inter` family is a web substitute and is **not** adopted.
- Stitch's scale (large-title 34/41 … caption-2 11/13) equals the iOS default Dynamic Type sizes, so the mapping is
  one-to-one: place name in sheet → `.title2`; row title → `.headline`; attributes → `.subheadline`; freshness,
  source → `.footnote`; badges → `.caption`.
- Distances and times use `.monospacedDigit()` (Stitch: tabular figures).

### 3.4 Spacing, shape, elevation

- Spacing comes from the system: default `List`/`Form` insets, default `padding()`, safe areas. Stitch's 4/8/12/16/20
  pt steps match system defaults and need no custom token.
- Corner radii, shadows and sheet chrome are the system's. Stitch's CSS shadows, 0.5 px hairlines, halo rings and
  `backdrop-filter` values are **not** reproduced.
- Floating map controls use `mapControls` (`MapUserLocationButton`, `MapCompass`, `MapScaleView`) or, while the
  `MKMapView` adapter is used, its native `MKUserTrackingButton` / compass / scale.

### 3.5 Design tokens summary

| Token | Implementation |
| --- | --- |
| accent | system tint (`AccentColor` left at the system default) |
| brand | `MannerPathYellow` asset (`#F5A623`): selected marker, filled selected state, primary CTA background only |
| backgrounds, labels, separators, fills | system semantic colours |
| type | SwiftUI text styles + Dynamic Type |
| spacing | system defaults; `padding()` |
| shape / elevation / material | system components only |
| evidence symbols | SF Symbols listed in §4 |

## 4. Domain invariants the UI must keep

These restate `docs/SPECIFICATION.md` for the UI; they are not new rules.

| Invariant | UI consequence |
| --- | --- |
| A convenience store existing ≠ an ashtray existing | No store/category icon or label implies a smoking place. Host names are context, never evidence. |
| Host existence alone never makes a spot | No marker, row or widget entry for a host without independent evidence. |
| Unknown ≠ false | Unknown hours, tobacco type, access show 「不明」 with `questionmark.circle`; never hidden, never shown as "no". `openNow` is never inferred. |
| Evidence and `locationPrecision` are separate axes | Two separate labels: evidence (e.g. `checkmark.seal`) and precision (`scope` = exact, `mappin.and.ellipse` = approximate). One never stands in for the other. |
| Approximate → 「この付近へ案内」 | `ApproximateLocation.navigationTitle` already returns "Navigate to this area"; approximate distance is 「約○m」. |
| Exact → 「この場所へ案内」 | Only for an exact point (ADR-0017). |
| Lower confidence is not a red warning | No `.red` / `.systemRed` for community or old data. Stitch's spec maps "1 year+ old" to `systemRed`; **rejected**. Use neutral/secondary styling plus explicit text 「最終確認: 1年以上前」. |
| Never colour alone | Every state = SF Symbol + Japanese text; VoiceOver value carries the same words. |
| No report form on Watch | Watch offers no report, add-place or correction UI; it may say "Report on iPhone". |
| No tobacco promotion | No streaks, points, rewards, badges-as-achievement, crowding scores, brand content. Stitch's add-place completion and 「今日確認できた (19)」 counters must not become gamified UI. |

Evidence labels (wording owned by ADR-0012 / `SpotPresentation`):

| Evidence | Symbol | Tint |
| --- | --- | --- |
| official / operator | `checkmark.seal.fill` | neutral (decided §9.2) |
| community verified | `person.2.fill` | neutral |
| community reported (single) | `person.fill.questionmark` | secondary |
| unknown | `questionmark.circle` | secondary |

## 5. Screen specifications

Each screen: **Current implementation → Stitch target → Apple-native interpretation → Required change.**

### 5.1 iPhone Nearby Map (root)

- **Current:** `ContentView` is a `NavigationStack` > `ScrollView` stacking location status, a 240 pt
  `ClusteredSpotMap`, the result list, nearby tasks, destination search and the report section. Toolbar: Filters
  (leading), Data & Privacy (trailing), Add a smoking place (bottom bar).
- **Stitch target (`通常探索画面`):** full-screen map, search field at the top, filter control, floating
  layers/location buttons, results in a bottom sheet with a count header (「12件」, 「最寄り 80m」).
- **Apple-native:** `NavigationStack` root whose content is the map filling the screen (ignoring safe areas behind
  bars). `ClusteredSpotMap` (`UIViewRepresentable` + `MKMapView`) stays as the clustering adapter — SwiftUI `Map`
  has no clustering on iOS 18 (see the header comment in `ClusteredSpotMap.swift`). Standard `.toolbar`: Filters, Data & Privacy, Add Place. Location /
  compass via native MapKit controls. Results always in a sheet (§5.3).
- **Required change:** replace the ScrollView shell with a map root; move the list, tasks and destination into the
  sheet; keep accessibility identifiers used by UI tests or update the tests in the same change.

### 5.2 Selected marker

- **Current:** markers tinted by evidence (`ClusteredSpotMap.tint`: official/operator → `.systemRed`, community
  verified → `.systemOrange`, reported/unknown → `.systemGray`). Tapping a pin pushes Spot Detail directly.
- **Stitch target (`地点選択状態`):** selected pin enlarged in brand yellow; a summary card with walk time, distance,
  evidence and a primary 「経路案内を開始」 button.
- **Apple-native:** `MKMarkerAnnotationView` selection (system enlarge animation). Selected marker uses the accent;
  unselected markers use neutral/secondary tints differentiated by glyph (filled vs outline), not by alarming
  colour. Approximate spots keep their area-anchor marker and VoiceOver value (ADR-0017).
- **Required change:** stop using red as the "official" tint (red reads as a warning); select-then-summarise in the
  sheet instead of pushing detail immediately.

### 5.3 Bottom sheet — medium / large

- **Current:** no persistent sheet; sheets are used only for report, quick confirm and filters.
- **Stitch target:** detents ≈ 0.12 (nearest only), ≈ 0.42 (three nearest + actions), large (full list); grabber
  visible; map remains interactive.
- **Apple-native (decided 2026-10-07, Phase 2):** one non-dismissable `.sheet` with the two system detents
  `.presentationDetents([.medium, .large], selection:)`, `.presentationDragIndicator(.visible)`,
  `.presentationBackgroundInteraction(.enabled(upThrough: .medium))`, `.interactiveDismissDisabled()`. System
  sheet background (no `presentationBackground` override), so it gains Liquid Glass on iOS 26.
  - **Medium = the compact / "collapsed" resting state:** map visible above; the sheet starts with the summary
    (count + nearest, or the selected place) as the first row of the results section, then the nearest results.
  - **Large:** full list, search results, details and Data & Privacy.
  - No smaller collapsed detent: a fixed `.fraction(0.25)` (Phase 1) clipped the summary, evidence and precision at
    large Dynamic Type sizes. Do not bring it back with a custom detent or a fixed/measured height.
- **Required change:** new sheet container; push navigation (detail) happens inside the sheet's own
  `NavigationStack` or the root stack — decide at implementation; do not build a custom draggable panel.

### 5.4 Nearby list

- **Current:** `NearbySpotRow` buttons inside the ScrollView, with destination-mode copy and route ranking.
- **Stitch target:** rows with walk time (headline), distance · type · access, evidence badge, freshness, precision
  (「高精度」「概算位置」), chevron.
- **Apple-native:** `List` rows (plain or inset-grouped) inside the sheet; badges are `Label`s, not custom chips.
  Header shows count and data freshness/state. Destination mode keeps its distance-origin explanation.
- **Required change:** move `NearbySpotRow` into a `List`; keep existing content and ranking. Do not add crowding,
  ratings or photo counts.

### 5.5 Selected spot (sheet summary)

- **Current:** none (pin tap → full detail).
- **Stitch target (`地点選択状態` lower half):** name, walk time, distance, evidence, primary route button, share,
  report flag.
- **Apple-native:** the sheet switches to a summary for the selected spot: title, distance/time, evidence label,
  precision label, freshness, `Button` 「この場所へ案内」/「この付近へ案内」 (`.borderedProminent`), and 「詳細」
  navigation. Deselecting returns to the list.
  - The directions button's label is **text only** (no SF Symbol) at every Dynamic Type size: the full wording is
    the exact/approximate distinction itself and must never truncate (an icon beside it did at AX5). Exact point →
    「この場所へ案内」; approximate or unknown precision → 「この付近へ案内」 (ADR-0017). Black text on
    `MannerPathYellow`.
  - Re-tapping the selected pin keeps the selection; only the Clear button removes it. Selecting scrolls the
    sheet to the summary.
- **Required change:** new selection state in the sheet; reuse `SpotPresentation` and `ApproximateLocation` copy.

### 5.6 Spot Detail — exact

- **Current:** `SpotDetailView` is a `Form`: header, confirmation summary, 「It was here」/「Something is different」,
  walking directions, use and access, evidence and freshness, suggest a correction. Title 「Place details」.
- **Stitch target (`地点詳細（公式・正確位置）`):** place name as title, primary 「この場所へ案内」, attributes,
  evidence and freshness, report entry.
- **Apple-native:** keep `Form`/inset-grouped `List`. Navigation title = place name (inline). No Share or Bookmark
  in v1 (decided §9.3). One primary `.borderedProminent` CTA. Map preview, if any, is a
  non-interactive MapKit snapshot or `Map` — not a custom image.
- **Required change:** mostly copy and hierarchy; align CTA wording; replace the red `mappin.circle.fill` glyph in
  directions with a neutral or accent glyph.

### 5.7 Spot Detail — approximate

- **Current:** same view; shows `ApproximateLocation.detailNote()` with `mappin.and.ellipse`; CTA "Navigate to this
  area".
- **Stitch target (`地点詳細（公式・概算位置）`):** separate "存在の確認状況" and "位置の精度" sections, area circle
  (「捜索目安エリア (約30m)」), CTA 「この付近へ案内」, unknown fields as 「不明」.
- **Apple-native:** two distinct `Section`s — evidence and location precision. Approximate area drawn with MapKit
  (`MKCircle` overlay / `MapCircle`), never as an exact pin. Distances prefixed 「約」.
- **Required change:** split evidence and precision into separate sections if not already visually separate;
  confirm the area radius comes from data (do not hard-code 30 m).

### 5.8 Filters

- **Current:** sheet > `NavigationStack` > `Form { NearbyFilterView }`, menus for physical type, access,
  environment; Done button; detents medium/large.
- **Stitch target (`フィルタ画面`):** tobacco type, facility conditions, evidence (「公式確認済みのみ」), freshness
  picker; Reset + Done in the toolbar.
- **Apple-native:** current structure already matches. Add a `cancellationAction`-placed Reset only if it does not
  conflict with Done semantics. A "confirmed only" filter must follow ADR-0012. Do not add 「24時間利用可能」 unless
  it is filterable without inferring `openNow`.
- **Required change:** small — optional Reset, grouping/labels. No new filter dimensions without a product change.

### 5.9 Destination search

- **Current:** `TextField("Search a destination in Apple Maps")` + Search button inside the ScrollView.
- **Stitch target:** search field at the top of the map. No dedicated destination screen in Stitch.
- **Apple-native:** `.searchable` on the root `NavigationStack` (or in the sheet), results as a native suggestion
  list, MapKit search (ADR-0001: MapKit is search infrastructure, results are not persisted as canonical spots).
- **Required change:** replace the inline text field with `.searchable`; keep destination-mode copy and the
  straight-line vs route explanation.

### 5.10 Empty

- **Current:** `ContentUnavailableView` variants: no published spots, no filter matches (+ Clear filters), saved
  data unavailable, waiting for location.
- **Stitch target (`状態1`〜`状態3`):** `ContentUnavailableView` with `mappin.slash` / `location.slash` /
  location failure; one primary action each.
- **Apple-native:** keep `ContentUnavailableView`, shown inside the sheet over the map (the map stays visible).
  Copy never says "no smoking places exist" — only "no published places in this data".
- **Required change:** relocate into the sheet; Stitch's "検索範囲を広げる" only if a wider search exists.

### 5.11 Offline

- **Current:** data states `cacheOnly`, `refreshFailed`, `cacheUnavailable` rendered as status text / unavailable
  views.
- **Stitch target (`状態4`〜`状態6`):** cached data stays visible with a non-blocking banner 「保存済みデータを表示
  しています（…同期）」; no cache → `wifi.exclamationmark` unavailable view; refresh failed → banner, data still
  usable.
- **Apple-native:** status as a row/section header in the sheet (not a custom toast). ADR-0004: cached spots,
  straight-line distance, bearing and freshness remain available offline; no offline turn-by-turn claim.
- **Required change:** map the existing states onto sheet header copy; no new states.

### 5.12 Add Place — pin

- **Current:** `ReportFormView` → `ReportPinPicker`: `MapReader` + SwiftUI `Map`, tap or use map centre, red
  `mappin.circle.fill`, lat/long `Stepper`s, Confirm button; duplicate candidates listed in the form.
- **Stitch target (`場所追加 Step 1`):** full-screen map with fixed centre pin; non-blocking banner
  「近隣に既存スポットがあります」 with duplicate candidates.
- **Apple-native:** full-height map in the report `NavigationStack`, centre pin overlay using an SF Symbol in the
  accent, confirm in the toolbar (`confirmationAction`). Duplicate candidates as a `List` section (ADR-0013).
- **Required change:** accent pin instead of red; keep steppers as an accessibility alternative to map dragging.

### 5.13 Add Place — details

- **Current:** `Form` in `ReportFormView`.
- **Stitch target (`場所追加 Step 2` / `Step 3`):** `Form` details, confirmation preview, terms toggle; completion
  「報告を受け付けました」 without rewards.
- **Apple-native:** current `Form` approach is correct. Completion: plain confirmation, no points/badges/animation.
- **Required change:** hierarchy/copy only.

### 5.14 Report Terms

- **Current:** `ReportTermsSheet` — `List` of sections, full-text push, Done.
- **Stitch target:** none as a standalone screen (terms appear inside Step 3).
- **Apple-native:** keep the sheet; link to it from the Step 3 consent row.
- **Required change:** none beyond linking.

### 5.15 Watch Nearby

- **Current:** `List` with eligibility section, saved/old-data section, filters, location section; toolbar refresh.
- **Stitch target (`Watch - 通常画面`, `古いデータ`, `オフライン`, `位置情報なし`, `保存データなし`):** header
  「周辺の喫煙所」, refresh, nearest row prominent (large distance), rows with walk time, type/access, evidence and
  freshness, 「※位置は目安」 for approximate, Quick filter button; empty/offline/no-location variants.
- **Apple-native:** watchOS `NavigationStack` + `List`; first row may use a larger distance text style. No `Map`.
  Old data shown as section header text, not a red state.
- **Required change:** row hierarchy only.

### 5.16 Watch Detail

- **Current:** `List`: navigation `Link` (exact/approximate title), Details, On-site check, Source sections.
- **Stitch target:** none.
- **Apple-native:** keep. **No report form** on the watch.
- **Required change:** none required by Stitch.

### 5.17 Source / License

- **Current:** `NearbyAttributionView`, `SourceAttributionPresentation` (Watch), `AboutPrivacyView` ("Data & Privacy").
- **Stitch target (`データとプライバシー`):** settings-style `Form`, `LabeledContent`, links to open data list and
  licences.
- **Apple-native:** settings-style `Form`. Attribution and licence text must remain reachable from every surface that
  shows imported data (DATA_POLICY). Stitch's example values (cache size, "完全匿名") are not product claims; copy
  must match `docs/APP_PRIVACY_INVENTORY.md`.
- **Required change:** layout only, if any.

### 5.18 Widget — small / medium / accessoryRectangular

- **Current:** `NearbyWidget` supports `.systemSmall`, `.systemMedium`, `.accessoryRectangular`;
  `WatchNearbyWidget` supports `.accessoryRectangular`.
- **Stitch target (`Widget仕様`):**
  - small: nearest place, large distance (accent), evidence + freshness, 「※位置は目安」; states for no location
    and community reported.
  - medium: 1–2 rows: name, evidence • freshness, distance, walk time.
  - accessoryRectangular: monochrome, symbol + name + distance + one status.
- **Apple-native:** `containerBackground(for: .widget)`, no nested cards; accessory families render in the system's
  vibrant/tinted mode (`widgetRenderingMode`), so meaning must survive without colour. Stale data shows text, not red.
- **Required change:** typography and accent use; no new data.

## 6. Accessibility

| Setting | Rule |
| --- | --- |
| Dynamic Type | All text uses text styles; rows wrap rather than truncate; `ViewThatFits` / `AnyLayout` (the existing `adaptiveRowLayout`) switches horizontal → vertical at accessibility sizes. The sheet uses only system detents (medium / large), so content scrolls rather than clips. |
| VoiceOver | Rows combine into one element: label = place name, value = distance, evidence, precision, freshness, access (Stitch spec §4 example), hint = what activation does. Markers keep the evidence + approximate value already passed to `ClusteredSpotMap`. Sheet detent changes are announced by the system. |
| Reduce Motion | Use system sheet/selection animations only; camera moves on selection use no animation (or a cross-fade) when `accessibilityReduceMotion` is on. |
| Reduce Transparency | Nothing to do beyond using system materials; the system swaps glass for opaque. No custom translucency that would ignore the setting. |
| Increase Contrast | System colours adapt automatically. `MannerPathYellow` is never the only carrier of meaning, so it needs no high-contrast variant; content on it is black. |
| Colour independence | Every status = symbol + text (§4). |

## 7. Liquid Glass policy

- Liquid Glass is obtained only from standard components on iOS 26 / watchOS 26: navigation bar, toolbar, `.searchable`,
  `.sheet`, map controls, `Button` styles.
- Do **not** call `glassEffect`, `GlassEffectContainer` or `.buttonStyle(.glass)` to manufacture glass on custom
  views. (If a future need appears, it requires an update to this document first.)
- Do not set `presentationBackground`, `toolbarBackground` or custom bar backgrounds that would block the system
  material.
- iOS 18 renders the same code with pre-Liquid-Glass materials; no `#available` forks for appearance.

## 8. Prohibited custom UI

- Custom navigation bar, custom tab bar.
- Custom glass, custom blur imitation (`.ultraThinMaterial` backgrounds on hand-made cards, blur + opacity stacks,
  CSS-style shadows). Stitch's floating search pill and filter-pill tray over the map are interpreted as
  `.searchable` + toolbar, not rebuilt.
- Custom bottom sheet / draggable panel. Use `.sheet` with detents.
- Replacing MapKit (no third-party map SDK, no custom tile renderer). `ClusteredSpotMap` (`UIViewRepresentable` +
  `MKMapView`) is allowed as the native clustering adapter.
- Custom fonts (Stitch `Inter`), custom card containers, nested rounded rectangles.
- Gamification: points, streaks, badges as rewards, confirmation counters as achievement.

## 9. Maintainer decisions (2026-10-06)

1. **MannerPath Yellow (revised 2026-10-06, PR #203).** Global `AccentColor` stays the system tint. `#F5A623` is a
   brand accent only for the selected marker, larger filled selected states and the primary CTA background, with
   black (or another measured high-contrast) foreground. Text, SF Symbols, toolbar, navigation and links use system
   foreground / tint. `#D98200` is not adopted as a text-safe token (2.94:1 on white); it remains only as a Stitch
   reference value and is not used for shipping text. Yellow stays at roughly 5–10 % of a screen and is never the
   meaning of a state by itself.
2. **Official-evidence marker: neutral.** Being official is not emphasised with yellow or red; only the selected
   state uses MannerPath Yellow.
3. **Share / Bookmark: not in v1.** Their presence in Stitch samples does not make them MannerPath v1 product
   requirements.

## 10. Current vs target summary

| Area | Current | Target |
| --- | --- | --- |
| iPhone shell | ScrollView with 240 pt embedded map | Full-screen map + persistent native sheet |
| Results | Inline buttons in ScrollView | `List` in sheet with medium/large |
| Pin tap | Pushes detail | Selects, summary in sheet, then detail |
| Marker tint | Red (official) / orange / grey | Neutral by glyph; accent only for selection |
| Destination | Inline `TextField` | `.searchable` |
| Accent | Empty `AccentColor` (system blue) | Unchanged system tint; `MannerPathYellow` brand asset for selection / primary CTA |
| Add-place pin | Red pin | Accent pin, same flow |
| Watch | List-first | List-first (row hierarchy tweaks) |
| Widgets | 3 families | Same families, accent/typography tweaks |

## Implementation order

Each step is one reviewable PR; each must keep `make apple-validate` green and update UI tests it touches.

1. iPhone Nearby Map-first shell (§5.1)
2. Bottom sheet / nearby list (§5.3, §5.4)
3. Selected marker / selected spot (§5.2, §5.5)
4. Exact / approximate detail (§5.6, §5.7)
5. Filters / destination (§5.8, §5.9)
6. Empty / offline (§5.10, §5.11)
7. Add Place / Report (§5.12–§5.14)
8. Watch (§5.15–§5.17)
9. Widgets (§5.18)
