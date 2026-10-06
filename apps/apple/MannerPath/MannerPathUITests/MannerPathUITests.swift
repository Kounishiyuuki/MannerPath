import XCTest

// Drives the real app against a local Worker. Simulator state (location, permission,
// appearance, text size, Worker up/down, app installed or not) is prepared outside the
// app by scripts/run-iphone-ui-tests.sh, which runs each class in the phase it needs.
// Strings are Japanese because the app is launched with the ja locale.

@MainActor
class MannerPathUITestCase: XCTestCase {
    let app = XCUIApplication()

    override func setUp() async throws {
        continueAfterFailure = false
    }

    func launch(acceptingEligibility: Bool = true, extraArguments: [String] = []) {
        app.launchArguments = ["-AppleLanguages", "(ja)", "-AppleLocale", "ja_JP"]
        if acceptingEligibility {
            // Standard UserDefaults argument domain; the app's own storage is unchanged.
            app.launchArguments += ["-eligibilityNoticeAccepted", "YES"]
        }
        app.launchArguments += extraArguments
        app.launch()
    }

    var phase: String { ProcessInfo.processInfo.environment["MP_PHASE"] ?? "default" }
    var resultRows: XCUIElementQuery { app.buttons.matching(identifier: "nearbyResultRow") }

    func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(phase)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func text(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func textContaining(_ fragment: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    // LabeledContent exposes a combined "label、value" element above the plain label, which is not hittable.
    func row(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "label BEGINSWITH %@ OR label BEGINSWITH %@", label + "、", label + ", "
        )).firstMatch
    }

    // Scrolls the frontmost scroll view until the element is hittable.
    func scrollTo(_ element: XCUIElement, upwards: Bool = false, maxSwipes: Int = 60, file: StaticString = #filePath, line: UInt = #line) {
        var swipes = 0
        while !(element.exists && element.isHittable) && swipes < maxSwipes {
            // Drag along the left margin: a swipe from the screen centre can land on a map and pan it.
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: upwards ? 0.35 : 0.75))
            start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: upwards ? 0.75 : 0.35)))
            swipes += 1
        }
        if !(element.exists && element.isHittable) {
            screenshot("scroll-failure")
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "\(phase)-scroll-failure-tree"
            tree.lifetime = .keepAlways
            add(tree)
        }
        XCTAssertTrue(element.exists && element.isHittable, "Could not scroll to \(element)", file: file, line: line)
    }

    func assertNoDeveloperText(file: StaticString = #filePath, line: UInt = #line) {
        let leak = NSPredicate(format: """
            label CONTAINS[c] '127.0.0.1' OR label CONTAINS[c] 'localhost' OR label CONTAINS[c] 'debug' \
            OR label CONTAINS[c] 'fixture' OR label CONTAINS 'Optional(' OR label CONTAINS 'nil'
            """)
        XCTAssertEqual(app.staticTexts.matching(leak).count, 0, "Developer text is visible", file: file, line: line)
    }

    // Captures every section of Data & Privacy, top to Diagnostics, for visual review in the current phase.
    func tourDataAndPrivacy() {
        app.buttons["データとプライバシー"].tap()
        XCTAssertTrue(app.navigationBars["データとプライバシー"].waitForExistence(timeout: 10))
        screenshot("40-privacy-top")
        for (index, header) in ["報告", "情報の品質", "診断情報"].enumerated() {
            scrollTo(text(header))
            screenshot("4\(index + 1)-privacy-\(header)")
        }
        let diagnostics = textContaining("クラッシュ報告ツールは含まれていません")
        scrollTo(diagnostics)
        screenshot("44-privacy-diagnostics")
        assertNoDeveloperText()
    }

    // List rows are created only near the visible part of the sheet, so at large text sizes the first row can still
    // be off screen; the summary 「N件の場所」 (shown whenever there are results and no destination) counts too.
    func waitForResults(file: StaticString = #filePath, line: UInt = #line) {
        let summary = app.descendants(matching: .any)["nearbySheetSummary"]
        let found = NSPredicate { _, _ in self.resultRows.firstMatch.exists || summary.exists }
        let expectation = XCTNSPredicateExpectation(predicate: found, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: 30), .completed, "No nearby results", file: file, line: line)
    }

    /// After choosing a destination: its Refresh leads the destination list, and the first place row may sit below a
    /// long note at large text sizes (List creates rows only near the visible part), so scroll to it.
    func waitForDestinationResults(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.buttons["refreshDestination"].waitForExistence(timeout: 40), "Destination was not selected",
                      file: file, line: line)
        scrollTo(resultRows.firstMatch, file: file, line: line)
    }

    /// Expands the sheet and brings the selected summary's directions button on screen, for screenshots at any text size.
    func showSelectedCallToAction(file: StaticString = #filePath, line: UInt = #line) {
        let title = app.navigationBars["近くの場所"]
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(1)
        scrollTo(app.buttons["selectedSpotDirections"], file: file, line: line)
    }

    var nearbyMap: XCUIElement { app.descendants(matching: .any)["nearbyMap"] }

    /// The system search field (`.searchable`) of the Nearby sheet.
    var destinationSearch: XCUIElement { app.searchFields.firstMatch }

    /// The number of shown places, read from the sheet summary 「N件の場所」: List rows are lazy, so counting row
    /// elements counts only what is on screen.
    func shownPlaceCount(file: StaticString = #filePath, line: UInt = #line) -> Int {
        let summary = app.descendants(matching: .any)["nearbySheetSummary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 10), "No nearby summary", file: file, line: line)
        return Int(summary.label.prefix { $0.isNumber }) ?? -1
    }

    /// Taps a single spot pin, expanding clusters first (ADR-0015). `value` narrows to pins whose VoiceOver value
    /// contains that text.
    @discardableResult
    func selectPin(valueContaining value: String? = nil, afterRecenter prepare: (() -> Void)? = nil,
                   file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        var predicate = "label ENDSWITH 'の詳細を表示'"
        if let value { predicate += " AND value CONTAINS '\(value)'" }
        let pins = app.buttons.matching(NSPredicate(format: predicate))
        let clusters = app.buttons.matching(NSPredicate(format: "label ENDSWITH '件の場所'"))
        XCTAssertTrue(pins.firstMatch.waitForExistence(timeout: 10) || clusters.firstMatch.waitForExistence(timeout: 10),
                      file: file, line: line)
        // A cluster tap zooms into that cluster only. Search the cluster tree depth first; every branch starts again
        // from the recentred map and replays its path (clusters ordered by position, so a path is repeatable).
        func hittableClusters() -> [XCUIElement] {
            clusters.allElementsBoundByIndex.filter(\.isHittable)
                .sorted { ($0.frame.minY, $0.frame.minX) < ($1.frame.minY, $1.frame.minX) }
        }
        func found() -> Bool { pins.allElementsBoundByIndex.contains(where: \.isHittable) }
        func explore(_ path: [Int]) -> Bool {
            app.buttons["現在地に戻す"].tap()
            sleep(2)
            prepare?()
            for index in path {
                let level = hittableClusters()
                guard index < level.count else { return false }
                level[index].tap()
                sleep(2)
            }
            if found() { return true }
            guard path.count < 3 else { return false }
            let count = hittableClusters().count
            for index in 0..<count where explore(path + [index]) { return true }
            return false
        }
        if prepare != nil || !found(), !explore([]) {
            app.buttons["現在地に戻す"].tap()
            sleep(2)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "\(phase)-pin-search-tree"
            tree.lifetime = .keepAlways
            add(tree)
            screenshot("pin-search-failure")
        }
        let pin = try XCTUnwrap(pins.allElementsBoundByIndex.first(where: \.isHittable),
                                "no single pin after expanding clusters", file: file, line: line)
        pin.tap()
        XCTAssertTrue(app.descendants(matching: .any)["selectedSpotSummary"].waitForExistence(timeout: 10),
                      "Pin tap did not show the selected-place summary", file: file, line: line)
        return pin
    }

    // docs/DESIGN.md §5.1: the map stays the full-screen root in every state; the sheet explains the state over it.
    func assertFullScreenMap(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(nearbyMap.waitForExistence(timeout: 10), "Map is missing", file: file, line: line)
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(nearbyMap.frame.height, window.height * 0.9, "Map is not full screen", file: file, line: line)
    }
}

final class A_FirstLaunchUITests: MannerPathUITestCase {
    func testEligibilityNoticeLeadsToNearby() {
        launch(acceptingEligibility: false)
        XCTAssertTrue(text("ご利用の前に").waitForExistence(timeout: 10))
        XCTAssertTrue(text("喫煙可能場所を探す").exists)
        screenshot("01-eligibility")
        app.buttons["確認しました"].tap()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        XCTAssertFalse(text("ご利用の前に").exists)
        assertNoDeveloperText()
    }
}

final class B_OnlineUITests: MannerPathUITestCase {
    func testNearbyLoadedShowsMapAndFirstResultWithoutScrolling() {
        launch()
        waitForResults()
        assertFullScreenMap()
        let first = resultRows.firstMatch
        if phase != "large-text" {
            let window = app.windows.firstMatch.frame
            XCTAssertTrue(first.isHittable)
            XCTAssertLessThanOrEqual(first.frame.maxY, window.maxY, "First result needs an initial scroll")
        }
        XCTAssertTrue(text("近くの場所").exists)
        assertNoDeveloperText()
        screenshot("02-nearby-loaded")
    }

    func testListRowOpensDetailWithKeySections() {
        launch()
        waitForResults()
        let first = resultRows.firstMatch
        scrollTo(first)
        first.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        XCTAssertTrue(row("場所の種類").exists)
        XCTAssertTrue(row("直線距離").exists)
        screenshot("03-detail-top")
        XCTAssertFalse(textContaining("更新中のため").exists, "Footer must not claim an update that is not running")
        scrollTo(app.buttons["open-walking-directions"])
        for label in ["利用条件", "最終確認日", "情報の新しさ"] {
            scrollTo(row(label))
        }
        let attribution = app.buttons.matching(NSPredicate(format: "label CONTAINS '出典'")).firstMatch
        scrollTo(attribution)
        let report = app.buttons.matching(NSPredicate(format: "label == 'この場所の情報を報告' OR label == '保存済みの報告を再開'")).firstMatch
        scrollTo(report)
        screenshot("04-detail-bottom")
        assertNoDeveloperText()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
    }

    func testMapPinOpensDetail() throws {
        launch()
        waitForResults()
        // A pin selects first (docs/DESIGN.md §5.5): a summary in the sheet, details one explicit step further.
        try selectPin()
        let summary = app.descendants(matching: .any)["selectedSpotSummary"]
        XCTAssertFalse(app.navigationBars["場所の詳細"].exists)
        XCTAssertTrue(text("選択中の場所").exists)
        // The directions call to action is the detail view's own, by location precision (ADR-0017).
        let directions = app.buttons["selectedSpotDirections"]
        XCTAssertTrue(directions.exists)
        XCTAssertTrue(["この場所へ案内", "この付近へ案内"].contains(directions.label), directions.label)
        let ctaLabel = directions.label
        screenshot("15-selected-spot")
        app.buttons["selectedSpotDetails"].tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        let detailDirections = app.buttons["open-walking-directions"]
        scrollTo(detailDirections)
        XCTAssertEqual(detailDirections.label, ctaLabel, "Summary and detail disagree on exact/approximate")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        app.buttons["clearSelectedSpot"].tap()
        XCTAssertTrue(summary.waitForNonExistence(timeout: 5))
    }

    // Codex P2 (#203): re-tapping the selected pin keeps it selected; only Clear removes the selection.
    func testReTappingSelectedPinKeepsSelection() throws {
        launch()
        waitForResults()
        let pin = try selectPin()
        let summary = app.descendants(matching: .any)["selectedSpotSummary"]
        let name = pin.label
        let selected = app.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
        XCTAssertTrue(String(describing: selected.value ?? "").hasPrefix("選択中"))
        selected.tap()
        sleep(1)
        XCTAssertTrue(summary.exists, "Re-tap cleared the summary")
        XCTAssertTrue(String(describing: selected.value ?? "").hasPrefix("選択中"), "Re-tap dropped the selected state")
        selected.tap()
        sleep(1)
        XCTAssertTrue(summary.exists)
        screenshot("18-reselected")
    }

    // The standard sheet moves between the system medium and large detents over the map; the map never goes away,
    // and the sheet cannot be dismissed. A selection made while the list is scrolled shows its summary at the top.
    func testSheetMovesBetweenMediumAndLargeOverMap() throws {
        launch()
        waitForResults()
        assertFullScreenMap()
        let window = app.windows.firstMatch.frame
        let title = app.navigationBars["近くの場所"]
        XCTAssertTrue(title.exists)
        let mediumTop = title.frame.minY
        XCTAssertGreaterThan(mediumTop, window.height * 0.3, "Sheet does not start at medium")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(1)
        XCTAssertLessThan(title.frame.minY, window.height * 0.25, "Sheet did not expand")
        XCTAssertTrue(resultRows.firstMatch.isHittable, "Expanded sheet does not show the nearby list")
        XCTAssertTrue(nearbyMap.exists)
        screenshot("17-sheet-large")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
        sleep(1)
        XCTAssertTrue(title.exists, "Sheet was dismissed")
        XCTAssertGreaterThan(title.frame.minY, window.height * 0.3, "Sheet did not return to medium")
        screenshot("16-sheet-medium")

        // Scroll the list, then select: the summary must come back into view (Codex P2 #203).
        scrollTo(resultRows.element(boundBy: 4))
        // Scrolling can grow the sheet to large; bring it back to medium so pins are reachable, keeping the scroll.
        if title.frame.minY < window.height * 0.3 {
            title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
            sleep(1)
        }
        try selectPin()
        let summary = app.descendants(matching: .any)["selectedSpotSummary"]
        XCTAssertTrue(app.buttons["selectedSpotDirections"].waitForExistence(timeout: 5))
        sleep(1)
        XCTAssertTrue(app.buttons["selectedSpotDirections"].isHittable, "Selected summary is off screen")
        XCTAssertTrue(summary.exists)
    }

    // Codex P2 (#203): at the largest accessibility text size the selected summary is complete — name, evidence,
    // directions and details are all reachable inside the sheet, none clipped away.
    func testSelectedSummaryIsCompleteAtLargeText() throws {
        launch()
        waitForResults()
        try selectPin()
        // At AX5 the medium sheet shows little; expand it as a reader would, keeping the summary at the top.
        let title = app.navigationBars["近くの場所"]
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(1)
        XCTAssertTrue(text("選択中の場所").exists || app.descendants(matching: .any)["selectedSpotSummary"].exists)
        // The accessibility label is the full string even when drawn truncated; truncation is checked on screenshot 19.
        XCTAssertTrue(["この場所へ案内", "この付近へ案内"].contains(app.buttons["selectedSpotDirections"].label))
        for element in [app.buttons["selectedSpotDirections"], app.buttons["selectedSpotDetails"]] {
            scrollTo(element)
            XCTAssertTrue(element.isHittable)
            XCTAssertGreaterThanOrEqual(element.frame.height, 44)
            XCTAssertLessThanOrEqual(element.frame.maxX, app.windows.firstMatch.frame.maxX)
        }
        screenshot("19-selected-large-text")
    }

    func testPhysicalTypeFilterEmptiesAndClearRestores() {
        launch()
        waitForResults()
        let before = shownPlaceCount()
        app.buttons["絞り込み"].tap()
        let typeMenu = app.buttons["場所の種類: 指定なし"]
        XCTAssertTrue(typeMenu.waitForExistence(timeout: 10))
        typeMenu.tap()
        // This Taito UI fixture has no confirmed physical type; other sources may have one.
        app.buttons["公共の喫煙室"].tap()
        XCTAssertTrue(app.buttons["場所の種類: 1件選択中"].waitForExistence(timeout: 5))
        screenshot("05-filters-selected")
        app.buttons["完了"].tap()
        XCTAssertTrue(app.buttons["絞り込み中"].waitForExistence(timeout: 5))
        XCTAssertTrue(text("条件に合う場所はありません").waitForExistence(timeout: 10))
        let clear = app.buttons["絞り込みを解除"]
        scrollTo(clear)
        screenshot("06-filters-empty")
        clear.tap()
        waitForResults()
        XCTAssertTrue(app.buttons["絞り込み"].exists)
        XCTAssertEqual(shownPlaceCount(), before)

        // Reopening shows the cleared state, not the earlier selection.
        app.buttons["絞り込み"].tap()
        XCTAssertTrue(app.buttons["場所の種類: 指定なし"].waitForExistence(timeout: 5))
        app.buttons["完了"].tap()
    }

    func testTobaccoFilterKeepsUnknownSupportVisible() {
        launch()
        waitForResults()
        let before = shownPlaceCount()
        app.buttons["絞り込み"].tap()
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'たばこの種類'")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        app.buttons["紙巻き"].tap()
        app.buttons["完了"].tap()
        waitForResults()
        // Only the fixture's heated-only booth is confirmed unsupported; unknown support stays listed.
        XCTAssertEqual(shownPlaceCount(), before - 1)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS '加熱式たばこ専用'")).firstMatch.exists)
        app.buttons["絞り込み中"].tap()
        let reopened = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'たばこの種類'")).firstMatch
        XCTAssertTrue(reopened.waitForExistence(timeout: 5))
        reopened.tap()
        app.buttons["指定なし"].firstMatch.tap()
        app.buttons["完了"].tap()
        XCTAssertTrue(app.buttons["絞り込み"].waitForExistence(timeout: 5))
    }

    func testDataAndPrivacyShowsLocationAndSources() {
        launch()
        waitForResults()
        app.buttons["データとプライバシー"].tap()
        XCTAssertTrue(app.navigationBars["データとプライバシー"].waitForExistence(timeout: 10))
        XCTAssertTrue(text("位置情報").exists || textContaining("位置情報").exists)
        screenshot("07-data-privacy")
        let sources = app.buttons["情報源と出典"]
        scrollTo(sources)
        sources.tap()
        XCTAssertTrue(app.navigationBars["情報源"].waitForExistence(timeout: 10))
        XCTAssertTrue(text("ライセンス").waitForExistence(timeout: 5))
        XCTAssertFalse(text("保存済みの出典情報はありません").exists)
        screenshot("08-sources")
        assertNoDeveloperText()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
    }

    func testReportDraftCanBeEditedClosedAndDiscardedWithoutSubmitting() {
        launch()
        waitForResults()
        resultRows.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        let report = app.buttons["この場所の情報を報告"]
        scrollTo(report)
        report.tap()
        XCTAssertTrue(app.navigationBars["場所の情報を報告"].waitForExistence(timeout: 10))
        XCTAssertTrue(textContaining("審査対象の提案").exists)

        let type = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '報告の種類'")).firstMatch
        XCTAssertTrue(type.waitForExistence(timeout: 5))
        type.tap()
        app.buttons["この場所は移転した"].tap()
        XCTAssertTrue(app.buttons["地図でピンを選ぶ"].waitForExistence(timeout: 5))

        let note = app.textViews["報告の補足"]
        scrollTo(note)
        note.tap()
        note.typeText("UIテスト")
        screenshot("09-report-draft")

        app.buttons["閉じる"].tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        let resume = app.buttons["保存済みの報告を再開"]
        scrollTo(resume)
        resume.tap()
        XCTAssertTrue(app.navigationBars["場所の情報を報告"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["地図でピンを選ぶ"].exists, "Draft type survived closing")
        // Submit stays available but is never tapped here; checked with the keyboard down so the row can be reached.
        scrollTo(app.buttons["審査用に送信"])
        app.buttons["下書きを破棄"].tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        scrollTo(app.buttons["この場所の情報を報告"])
    }

    func testDestinationSearchCanBeOperated() {
        launch()
        waitForResults()
        let field = destinationSearch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "No system search field")
        XCTAssertEqual(app.textFields.matching(NSPredicate(format: "placeholderValue == 'Appleマップで目的地を検索'")).count, 0,
                       "The inline destination text field is replaced by the system search field")
        field.tap()
        field.typeText("上野駅")
        // Submit from the keyboard: the keyboard's own search key shares the "検索" label.
        field.typeText("\n")
        // MapKit search is live and not deterministic here; accept any of its honest outcomes.
        let outcome = NSPredicate(format: """
            label CONTAINS '目的地を検索できません' OR label CONTAINS '目的地を検索中' OR label CONTAINS '上野'
            """)
        let anyOutcome = app.descendants(matching: .any).matching(outcome).firstMatch
        XCTAssertTrue(anyOutcome.waitForExistence(timeout: 20))
        screenshot("10-destination")
        XCTAssertTrue(app.navigationBars["近くの場所"].exists)
        XCTAssertTrue(resultRows.firstMatch.exists, "Saved places stay listed during destination search")
    }

    func testDataAndPrivacyFullPage() {
        launch()
        waitForResults()
        tourDataAndPrivacy()
    }

    func testIconOnlyActionsHaveLabels() {
        launch()
        waitForResults()
        XCTAssertTrue(app.buttons["絞り込み"].exists)
        XCTAssertTrue(app.buttons["データとプライバシー"].exists)
        // The location row sits below the results; List creates rows only near the visible part of the sheet.
        scrollTo(app.buttons["更新"])
        XCTAssertTrue(app.buttons["現在地に戻す"].exists)
        let row = resultRows.firstMatch
        XCTAssertFalse(row.label.isEmpty)
        XCTAssertTrue(row.label != "nearbyResultRow")
    }
}

final class C_OfflineWithCacheUITests: MannerPathUITestCase {
    func testCachedResultsRemainAndFailureIsExplained() {
        launch()
        waitForResults()
        XCTAssertTrue(textContaining("読み込み、または更新できませんでした").waitForExistence(timeout: 30))
        XCTAssertFalse(text("近くの場所の情報を読み込めませんでした").exists)
        assertFullScreenMap()
        screenshot("11-offline-cached")
    }
}

final class D_CleanOfflineUITests: MannerPathUITestCase {
    func testNoCacheAndNoBackendIsDistinctFromNoPublishedPlaces() {
        launch()
        XCTAssertTrue(text("近くの場所の情報を読み込めませんでした").waitForExistence(timeout: 30))
        XCTAssertEqual(resultRows.count, 0)
        XCTAssertFalse(text("この周辺に掲載中の場所はありません").exists)
        XCTAssertFalse(textContaining("利用可能な保存済みの結果を表示します").exists,
                       "Must not claim saved results that do not exist")
        XCTAssertFalse(textContaining("保存済みの下書きはこのデバイスに残ります").exists)
        assertFullScreenMap()
        screenshot("12-clean-offline")
        // Reporting availability is unknown here: Data & Privacy must not advertise intake.
        app.buttons["データとプライバシー"].tap()
        XCTAssertTrue(app.navigationBars["データとプライバシー"].waitForExistence(timeout: 10))
        scrollTo(textContaining("報告機能を利用できるか確認できませんでした"))
        XCTAssertFalse(textContaining("報告は審査対象の提案です").exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        tourDataAndPrivacy()
    }
}

final class E_LocationDeniedUITests: MannerPathUITestCase {
    func testDeniedOffersSettings() {
        launch()
        XCTAssertTrue(textContaining("位置情報の利用がオフです").waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["設定を開く"].exists)
        XCTAssertEqual(resultRows.count, 0)
        assertFullScreenMap()
        screenshot("13-location-denied")
    }
}

final class F_LocationNotDeterminedUITests: MannerPathUITestCase {
    func testNotDeterminedAsksOnlyThroughExplicitAction() {
        launch()
        XCTAssertTrue(app.buttons["現在地を使用"].waitForExistence(timeout: 15))
        XCTAssertEqual(resultRows.count, 0)
        assertFullScreenMap()
        screenshot("14-location-not-determined")
    }
}

// Runs only against the local copy prepared by services/api/scripts/local-ui-fixture.ts (TEST ONLY): an
// areaApproximate spot in 上野恩賜公園, a communityReported ashtray beside the fixed location, and the Taito corpus.
final class G_VisualAuditUITests: MannerPathUITestCase {
    func row(valueContaining fragment: String) -> XCUIElement {
        resultRows.matching(NSPredicate(format: "value CONTAINS %@", fragment)).firstMatch
    }

    func openRow(_ element: XCUIElement) {
        scrollTo(element)
        element.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
    }

    // ADR-0017 on the map: an area-anchor pin's summary says 「この付近へ案内」 and shows its precision line.
    func testApproximatePinSummaryNeverReadsAsExact() throws {
        launch()
        waitForResults()
        // This fixture's area anchor clusters right under the current-location marker, which always draws on top
        // (required priority), so the cluster cannot be tapped at the default zoom. Zoom in beside the marker first,
        // as a person would.
        try selectPin(valueContaining: "位置は上野恩賜公園内の目安です") {
            let me = self.app.otherElements.matching(NSPredicate(format: "label == '現在地'")).firstMatch
            guard me.exists else { return }
            for _ in 0..<2 {
                me.coordinate(withNormalizedOffset: CGVector(dx: -1.5, dy: -0.5)).doubleTap()
                sleep(2)
            }
        }
        XCTAssertEqual(app.buttons["selectedSpotDirections"].label, "この付近へ案内")
        XCTAssertTrue(app.descendants(matching: .any)["selectedSpotPrecision"].exists)
        showSelectedCallToAction()
        screenshot("20b-selected-approximate")
    }

    // An exact point (no precision note) says 「この場所へ案内」; any precision note means 「この付近へ案内」.
    func testOfficialPinSummaryCallToActionFollowsPrecision() throws {
        launch()
        waitForResults()
        try selectPin(valueContaining: "公式確認済み")
        let label = app.buttons["selectedSpotDirections"].label
        let hasPrecisionNote = app.descendants(matching: .any)["selectedSpotPrecision"].exists
        XCTAssertEqual(label, hasPrecisionNote ? "この付近へ案内" : "この場所へ案内")
        showSelectedCallToAction()
        screenshot("27b-selected-official")
    }

    func testApproximatePlaceNeverReadsAsExact() {
        launch()
        waitForResults()
        let approximate = row(valueContaining: "位置は上野恩賜公園内の目安です")
        scrollTo(approximate)
        screenshot("20-list-approximate-row")
        approximate.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["approximate-location-note"].exists)
        XCTAssertTrue(textContaining("約").exists, "Approximate distance is prefixed with 約")
        screenshot("21-detail-approximate-top")
        let directions = app.buttons["open-walking-directions"]
        scrollTo(directions)
        XCTAssertEqual(directions.label, "この付近へ案内")
        screenshot("22-detail-approximate-directions")
        scrollTo(row("位置情報"))
        screenshot("23-detail-approximate-evidence")
    }

    func testCommunityReportedPlaceNeverReadsAsOfficial() {
        launch()
        waitForResults()
        let community = row(valueContaining: "利用者報告")
        scrollTo(community)
        XCTAssertFalse(community.value.debugDescription.contains("公式"))
        screenshot("24-list-community-row")
        community.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        screenshot("25-detail-community-top")
        let note = textContaining("1人の利用者の報告をMannerPathが審査したもの")
        scrollTo(note)
        XCTAssertFalse(textContaining("公式確認済み").exists)
        screenshot("26-detail-community-evidence")
        assertNoDeveloperText()
    }

    func testExactPlaceDirectionsHandOffToMaps() {
        launch()
        waitForResults()
        openRow(row(valueContaining: "公式確認済み"))
        // Taito leaves tobacco support unstated: unknown must stay unknown, never no.
        for label in ["紙巻きたばこ", "加熱式たばこ"] {
            let value = row(label)
            scrollTo(value)
            XCTAssertTrue(value.label.contains("不明"), "\(label) shows \(value.label)")
        }
        screenshot("27-detail-unknown-values")
        let directions = app.buttons["open-walking-directions"]
        scrollTo(directions)
        XCTAssertEqual(directions.label, "この場所へ案内")
        screenshot("28-detail-route-preview")
        directions.tap()
        let maps = XCUIApplication(bundleIdentifier: "com.apple.Maps")
        XCTAssertTrue(maps.wait(for: .runningForeground, timeout: 15), "Apple Maps did not open")
        let attachment = XCTAttachment(screenshot: maps.screenshot())
        attachment.name = "\(phase)-29-maps-handoff"
        attachment.lifetime = .keepAlways
        add(attachment)
        app.activate()
    }

    func testAddPlaceWarnsAboutNearbyDuplicateAndShowsTerms() {
        launch()
        waitForResults()
        // A draft left by an earlier test replaces the add action with "continue saved report".
        let saved = app.buttons["保存済みの報告を再開"]
        if saved.exists {
            saved.tap()
            app.buttons["下書きを破棄"].tap()
        }
        let add = app.buttons.matching(NSPredicate(format: "label == '喫煙場所を追加'")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        add.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        screenshot("30-add-place")
        app.buttons["地図でピンを選ぶ"].tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForExistence(timeout: 10))
        app.buttons["地図の中心を使用"].tap()
        let confirm = app.buttons["提案するピンを確定"]
        scrollTo(confirm)
        screenshot("31-add-place-pin")
        confirm.tap()
        let duplicate = text("これではありませんか？")
        XCTAssertTrue(duplicate.waitForExistence(timeout: 10), "No duplicate warning for a pin beside a listed place")
        scrollTo(duplicate)
        screenshot("32-add-place-duplicate")
        let terms = app.buttons["報告に関する規約を読む"]
        scrollTo(terms)
        screenshot("33-add-place-consent")
        terms.tap()
        XCTAssertTrue(app.navigationBars["報告に関する規約"].waitForExistence(timeout: 10))
        screenshot("34-report-terms")
        app.buttons["完了"].tap()
        app.buttons["下書きを破棄"].tap()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
    }
}

// Release-build check of the public site links (docs/PUBLIC_SITE.md). Needs the internet and a Release build,
// so it is not part of scripts/run-iphone-ui-tests.sh phases; run it as documented in docs/PUBLIC_SITE.md.
final class H_PublicSiteLinksUITests: MannerPathUITestCase {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")

    func openDataAndPrivacy() {
        launch()
        let privacy = app.buttons["データとプライバシー"]
        XCTAssertTrue(privacy.waitForExistence(timeout: 30))
        privacy.tap()
        XCTAssertTrue(app.navigationBars["データとプライバシー"].waitForExistence(timeout: 10))
    }

    func assertSafariShows(_ heading: String, shot: String) {
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "Safari did not open")
        let title = safari.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", heading)).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 30), "\(heading) not shown")
        XCTAssertFalse(safari.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS '404'")).firstMatch.exists)
        let address = safari.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS 'kounishiyuuki.github.io' OR value CONTAINS 'kounishiyuuki.github.io'")).firstMatch
        // The capsule briefly shows a transient label (e.g. Reader available) before the domain.
        let addressShown = address.waitForExistence(timeout: 10)
        if !addressShown {
            let tree = XCTAttachment(string: safari.debugDescription)
            tree.name = "\(phase)-safari-tree"
            tree.lifetime = .keepAlways
            add(tree)
        }
        XCTAssertTrue(addressShown, "Address is not the published site")
        let attachment = XCTAttachment(screenshot: safari.screenshot())
        attachment.name = "\(phase)-\(shot)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testPrivacyPolicyAndSupportOpenThePublishedPages() {
        openDataAndPrivacy()
        let policy = app.buttons["プライバシーポリシー"]
        XCTAssertTrue(policy.exists, "Privacy Policy link missing: MannerPathPublicSiteURL not set in this build")
        XCTAssertTrue(app.buttons["サポート"].exists)
        screenshot("50-privacy-links")
        policy.tap()
        assertSafariShows("MannerPath プライバシーポリシー", shot: "51-safari-privacy")
        app.activate()
        XCTAssertTrue(app.navigationBars["データとプライバシー"].waitForExistence(timeout: 10))
        app.buttons["サポート"].tap()
        assertSafariShows("MannerPath サポート", shot: "52-safari-support")
        app.activate()
    }

    func testEmailContactAddressesTheSupportMailbox() {
        openDataAndPrivacy()
        let contact = app.buttons.matching(NSPredicate(format: "label CONTAINS 'mannerpath.support@gmail.com'")).firstMatch
        XCTAssertTrue(contact.exists, "Email contact missing")
        contact.tap()
        // The simulator has no Mail account; capture whatever the system shows for the mailto: hand-off.
        sleep(3)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let attachment = XCTAttachment(screenshot: springboard.screenshot())
        attachment.name = "\(phase)-53-mailto"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

// Release-build check against the production API (docs/RELEASE_CHECKLIST.md §2). Needs the internet, a Release
// build (MANNERPATH_API_BASE_URL) and a Taito location; not part of scripts/run-iphone-ui-tests.sh phases.
// Read-only: it never opens a report form or submits anything.
final class I_ProductionAPIUITests: MannerPathUITestCase {
    func testReleaseBuildReadsProductionDataWithReportsUnavailable() {
        launch()
        waitForResults()
        XCTAssertTrue(text("近くの場所の情報を更新しました。").waitForExistence(timeout: 30), "Live refresh did not succeed")
        screenshot("70-production-nearby")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label == '喫煙場所を追加'")).firstMatch.exists,
                       "Add-place must be hidden while production reports are unavailable")

        let first = resultRows.firstMatch
        scrollTo(first)
        first.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        XCTAssertTrue(row("直線距離").exists)
        screenshot("71-production-detail")
        let unavailable = text("現在、報告機能を利用できません。")
        scrollTo(unavailable)
        XCTAssertFalse(app.buttons["この場所の情報を報告"].exists)
        let attribution = app.buttons["情報源と法的な出典表示"]
        scrollTo(attribution)
        screenshot("72-production-detail-sources")
        attribution.tap()
        XCTAssertTrue(app.navigationBars["情報源"].waitForExistence(timeout: 10))
        XCTAssertTrue(text("ライセンス").waitForExistence(timeout: 5))
        XCTAssertTrue(textContaining("台東区").exists, "Taito attribution expected from the production tile")
        screenshot("73-production-attribution")
        assertNoDeveloperText()
    }
}

final class J_ProductionDestinationUITests: MannerPathUITestCase {
    func testOutsideJapanDestinationLoadsPublishedTokyoPlaces() {
        launch()
        XCTAssertTrue(text("近くの場所の情報を更新しました。").waitForExistence(timeout: 40))
        XCTAssertEqual(resultRows.count, 0)
        XCTAssertFalse(text("この付近の喫煙場所を知っていれば、審査用に追加できます。").exists)
        let search = destinationSearch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("浅草駅 東京\n")
        let match = app.buttons.matching(identifier: "destinationMatch").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40), "Real MapKit search returned no destination")
        scrollTo(match)
        match.tap()
        waitForDestinationResults()
        let refresh = app.buttons["refreshDestination"]
        scrollTo(refresh, upwards: true)
        refresh.tap()
        XCTAssertTrue(text("近くの場所の情報を更新しました。").waitForExistence(timeout: 40))
        XCTAssertTrue(resultRows.firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["nearbyMap"].exists)
        screenshot("80-production-destination")
        let first = resultRows.firstMatch
        scrollTo(first)
        first.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        XCTAssertTrue(text("距離と方角は選択した目的地を基準にした目安です。端末の現在地からの距離や徒歩ルートではありません。").exists)
        XCTAssertTrue(text("徒歩ルートを利用できません。上の直線距離と方角は引き続き確認できます。").exists ||
                      text("徒歩ルートの確認には現在地が必要です。直線距離の目安は引き続き確認できます。").exists)
        let attribution = app.buttons["情報源と法的な出典表示"]
        scrollTo(attribution)
        attribution.tap()
        XCTAssertTrue(app.navigationBars["情報源"].waitForExistence(timeout: 10))
        XCTAssertTrue(textContaining("台東区").exists)
        let notice = app.descendants(matching: .any)["sourceModificationNotice"].firstMatch
        scrollTo(notice)
        XCTAssertTrue(notice.label.contains("MannerPathは元データから喫煙場所の情報を抽出・正規化"))
        screenshot("82-production-source-processing-notice")
        let prescribed = textContaining("台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ")
        scrollTo(prescribed)
        let licenseLink = app.descendants(matching: .any)["sourceLicenseLink"].firstMatch
        scrollTo(licenseLink)
        XCTAssertTrue(text("ライセンス").exists)
        XCTAssertTrue(licenseLink.isHittable)
        screenshot("81-production-destination-attribution")
        assertNoDeveloperText()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let clear = app.buttons["消去"]
        scrollTo(clear)
        // scrollTo stops once the button is hittable, which can be the home-indicator edge where a synthesized tap
        // is swallowed; move it clear of the bottom edge first.
        if clear.frame.maxY > app.windows.firstMatch.frame.maxY - 120 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.75))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.55)))
        }
        clear.tap()
        // The cleared destination row disappears before the device area reloads; a missed tap fails here, not later.
        XCTAssertTrue(app.buttons["消去"].waitForNonExistence(timeout: 10), "Destination was not cleared")
        XCTAssertTrue(text("近くの場所の情報を更新しました。").waitForExistence(timeout: 30))
        XCTAssertEqual(resultRows.count, 0, "Destination places must not remain in the device-area list")
    }
}

final class K_DeniedProductionDestinationUITests: MannerPathUITestCase {
    func testDeniedDestinationCanRefreshWithoutLocationPermission() {
        launch()
        XCTAssertTrue(textContaining("位置情報の利用がオフです").waitForExistence(timeout: 15))
        let search = destinationSearch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap()
        search.typeText("浅草駅 東京\n")
        let match = app.buttons.matching(identifier: "destinationMatch").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40))
        scrollTo(match)
        match.tap()
        waitForDestinationResults()
        let refresh = app.buttons["refreshDestination"]
        scrollTo(refresh, upwards: true)
        refresh.tap()
        XCTAssertTrue(text("近くの場所の情報を更新しました。").waitForExistence(timeout: 40))
        XCTAssertTrue(resultRows.firstMatch.exists)
        // The location row follows the results; List creates it once it scrolls into view.
        scrollTo(textContaining("位置情報の利用がオフです"))
        XCTAssertFalse(app.alerts.firstMatch.exists)
    }
}

// #190 follow-up: the destination Refresh at the largest accessibility text size (AX5). The size is forced for this
// app only through the standard UIKit launch argument, so it runs with the production destination tests (J/K) and
// needs no simulator-wide setting. The button must stay fully on screen, keep a 44 pt hit target and its label.
final class L_ProductionDestinationLargeTextUITests: MannerPathUITestCase {
    func testDestinationRefreshFitsAtLargestAccessibilityTextSize() {
        launch(extraArguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        let search = destinationSearch
        XCTAssertTrue(search.waitForExistence(timeout: 40))
        search.tap()
        search.typeText("浅草駅 東京\n")
        let match = app.buttons.matching(identifier: "destinationMatch").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40), "Real MapKit search returned no destination")
        scrollTo(match)
        match.tap()
        waitForDestinationResults()
        let refresh = app.buttons["refreshDestination"]
        scrollTo(refresh, upwards: true)
        let window = app.windows.firstMatch.frame
        XCTAssertEqual(refresh.label, "更新")
        XCTAssertGreaterThanOrEqual(refresh.frame.minX, window.minX, "Refresh starts off screen at AX5")
        XCTAssertLessThanOrEqual(refresh.frame.maxX, window.maxX, "Refresh is clipped at AX5")
        XCTAssertGreaterThanOrEqual(refresh.frame.height, 44, "Refresh hit target is below 44 pt at AX5")
        screenshot("90-destination-refresh-ax5")
        refresh.tap()
        XCTAssertTrue(text("近くの場所の情報を更新しました。").waitForExistence(timeout: 40))
        // At AX5 the first row sits below the long destination notes; List creates it once it scrolls into view.
        scrollTo(resultRows.firstMatch)
        assertNoDeveloperText()
    }
}

// Map-first shell under accessibility display settings (Reduce Motion, Reduce Transparency, Increase Contrast), set on
// the simulator outside the app. Read-only against the production API with a Taito location, like I; not part of
// scripts/run-iphone-ui-tests.sh phases. Measures the 44 pt targets of the controls the shell added.
final class M_MapFirstAccessibilityUITests: MannerPathUITestCase {
    func selectedPinElement(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    // System toolbar items are measured and recorded only: their hit region is UIKit's, and resizing them would mean
    // replacing a system control (docs/DESIGN.md §8). Controls MannerPath draws itself must be at least 44 pt.
    func assertTarget(_ element: XCUIElement, _ name: String, systemControl: Bool = false,
                      file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(name) missing", file: file, line: line)
        XCTAssertTrue(element.isHittable, "\(name) not hittable", file: file, line: line)
        let frame = element.frame
        if !systemControl {
            XCTAssertGreaterThanOrEqual(frame.width, 44, "\(name) is \(frame.width) pt wide", file: file, line: line)
            XCTAssertGreaterThanOrEqual(frame.height, 44, "\(name) is \(frame.height) pt high", file: file, line: line)
        }
        let note = XCTAttachment(string: "\(name): \(frame.width) x \(frame.height) pt")
        note.name = "\(phase)-target-\(name)"
        note.lifetime = .keepAlways
        add(note)
    }

    func testShellSheetAndSelectedMarkerUnderDisplaySettings() throws {
        launch()
        waitForResults()
        assertFullScreenMap()
        screenshot("60-shell")
        for name in ["絞り込み", "現在地に戻す", "データとプライバシー"] {
            assertTarget(app.buttons[name], name, systemControl: true)
        }

        let pins = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'の詳細を表示'"))
        let clusters = app.buttons.matching(NSPredicate(format: "label ENDSWITH '件の場所'"))
        XCTAssertTrue(pins.firstMatch.waitForExistence(timeout: 10) || clusters.firstMatch.waitForExistence(timeout: 10))
        for _ in 0..<4 where !pins.allElementsBoundByIndex.contains(where: \.isHittable) {
            clusters.allElementsBoundByIndex.first(where: \.isHittable)?.tap()
            sleep(2)
        }
        let pin = try XCTUnwrap(pins.allElementsBoundByIndex.first(where: \.isHittable))
        let pinLabel = pin.label
        pin.tap()
        XCTAssertTrue(app.descendants(matching: .any)["selectedSpotSummary"].waitForExistence(timeout: 10))
        assertTarget(selectedPinElement(pinLabel), "selectedPin", systemControl: true)
        // Selection is stated in words, not only by the yellow marker.
        XCTAssertTrue(text("選択中の場所").exists)
        let selectedPin = selectedPinElement(pinLabel)
        XCTAssertTrue(String(describing: selectedPin.value ?? "").hasPrefix("選択中"), "Selected pin value: \(String(describing: selectedPin.value))")
        assertTarget(app.buttons["selectedSpotDirections"], "selectedSpotDirections")
        assertTarget(app.buttons["selectedSpotDetails"], "selectedSpotDetails")
        assertTarget(app.buttons["clearSelectedSpot"], "clearSelectedSpot")
        screenshot("61-selected")

        app.buttons["selectedSpotDetails"].tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        assertFullScreenMap()
        screenshot("62-back-to-sheet")
        assertNoDeveloperText()
    }
}
