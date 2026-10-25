import XCTest

/// Same real app, public fixed test location and flow before/after. No app-only test hooks or search replacement.
@MainActor
final class NativeSearchSheetUITests: MannerPathUITestCase {
    /// No local Worker or smoking-place fixture is needed: these are live MapKit destination candidates.
    func testLiveMapKitTypingAndOneTapSelectionSmoke() throws {
        launch()
        let field = destinationSearch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("上野")
        let matches = app.buttons.matching(identifier: "destinationMatch")
        let unavailable = textContaining("目的地を検索できません")
        let empty = textContaining("一致する目的地")
        let terminal = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.app.progressIndicators["destinationSearchProgress"].exists
                && (matches.firstMatch.exists || unavailable.exists || empty.exists)
        }, object: nil)
        guard XCTWaiter().wait(for: [terminal], timeout: 45) == .completed else {
            screenshot("live-mapkit-timeout-not-for-submission")
            XCTFail("Live MapKit never reached an outcome")
            return
        }
        guard matches.firstMatch.exists else {
            screenshot("live-mapkit-no-candidates-not-for-submission")
            throw XCTSkip("Live MapKit returned no candidate or was unavailable; this is not a product-requirement PASS")
        }
        // Integration smoke: provider cardinality, identity and ordering vary. Concrete multi-result UX is tested
        // separately with the deterministic provider; never demand a fixed station or minimum live result count.
        let candidate = matches.firstMatch
        XCTAssertFalse(candidate.label.isEmpty)
        assertDestinationCandidateAboveKeyboard(candidate)
        screenshot("live-mapkit-candidates-not-for-submission")
        candidate.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 15))
        let selected = app.buttons["refreshDestination"]
        scrollForegroundListTo(selected)
        XCTAssertTrue(selected.exists && selected.isHittable)
        screenshot("live-mapkit-destination-selected-not-for-submission")
    }

    // Preserved opt-in live integration journey: requires the local published corpus as well as MapKit.
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
        // Several candidates now lead the sheet, so the saved rows sit below them rather than on the first screen.
        scrollTo(resultRows.firstMatch)
        XCTAssertTrue(resultRows.firstMatch.exists, "Saved places stay listed during destination search")
    }

    override func screenshot(_ name: String) {
        // App-only captures can crop an iPhone compatibility window on iPad. Inspect the actual whole display.
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "\(phase)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testNativeSheetDetentsKeepMapAndSearchReachable() {
        launch()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        waitForSheet(Self.mediumSheet, "Sheet does not start at medium")
        XCTAssertTrue(destinationSearch.isHittable)
        XCTAssertTrue(nearbyMap.exists)
        screenshot("07-sheet-medium")
        dragSheet(to: 0.05, settlingIn: Self.largeSheet, "Sheet did not expand")
        XCTAssertTrue(destinationSearch.isHittable)
        screenshot("08-sheet-large")
        dragSheet(to: 0.55, settlingIn: Self.mediumSheet, "Sheet did not return to medium")
        XCTAssertTrue(nearbyMap.exists)
        screenshot("09-sheet-medium-restored")
    }

    /// Collapsed: the map has the screen, search and Show List stay whole and tappable, panning the map leaves the
    /// sheet alone, and search expands it above the keyboard; pulling it down again puts the keyboard away.
    func testCollapsedSheetKeepsSearchAndListReachable() {
        launch()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        dragSheet(to: 0.98, settlingIn: Self.collapsedSheet, "Sheet did not collapse")
        let window = app.windows.firstMatch.frame
        let showList = app.buttons["showNearbyList"]
        for element in [destinationSearch, showList] {
            XCTAssertTrue(element.waitForExistence(timeout: 5) && element.isHittable, "\(element) is not reachable")
            XCTAssertTrue(window.contains(element.frame), "\(element) is clipped at \(element.frame)")
            XCTAssertGreaterThanOrEqual(element.frame.height, 36)
        }
        XCTAssertGreaterThanOrEqual(showList.frame.height, 44)
        XCTAssertFalse(resultRows.firstMatch.exists && resultRows.firstMatch.isHittable, "Collapsed sheet still shows the list")
        screenshot("20-sheet-collapsed")

        // Panning the map must not grow the sheet.
        nearbyMap.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            .press(forDuration: 0.05, thenDragTo: nearbyMap.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.2)))
        waitForSheet(Self.collapsedSheet, "Panning the map expanded the sheet")

        showList.tap()
        waitForSheet(Self.mediumSheet, "Show List did not return to medium")
        XCTAssertFalse(showList.exists)

        dragSheet(to: 0.98, settlingIn: Self.collapsedSheet, "Sheet did not collapse again")
        destinationSearch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        waitForSheet(Self.largeSheet, "Search did not expand the sheet above the keyboard")
        // The detent itself is large, not a collapsed sheet lifted by the keyboard.
        XCTAssertTrue(showList.waitForNonExistence(timeout: 5), "Search left the sheet at the collapsed detent")
        screenshot("21-collapsed-search-focused")
        // Put the keyboard away by pulling the sheet down, as a reader would; the Cancel control differs by iOS version.
        dragSheet(to: 0.98, settlingIn: Self.collapsedSheet, "Sheet did not collapse after search")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Collapsing left the keyboard up")
        XCTAssertTrue(destinationSearch.isHittable && showList.isHittable)
        screenshot("22-collapsed-after-search")
    }

    func testSearchSheetVisualJourney() throws {
        launch()
        establishPublishedArea()
        screenshot("01-normal-multiple")
        let field = destinationSearch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        clearSearch(field)
        field.typeText("上")
        screenshot("02-typing")
        field.typeText("野駅")
        let match = taitoDestinationMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40), "MapKit must provide actual candidates for this visual comparison")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertTrue(match.isHittable)
        XCTAssertGreaterThanOrEqual(match.frame.height, 44)
        XCTAssertFalse(match.label.isEmpty)
        screenshot("03-candidates")
        match.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Selecting a destination ends system search")
        waitForVisualDestinationResults()
        XCTAssertTrue(resultRows.firstMatch.exists)
        screenshot("04-destination-selected")
        assertNoDeveloperText()
    }

    /// Live MapKit: each query shows candidates while typing (no search button), the one named for it is listed first
    /// and above the keyboard, and choosing it switches the list to places near that destination.
    func testTypedQueriesShowNamedCandidatesAboveKeyboardAndSelectionSwitchesDestination() {
        launch()
        let field = destinationSearch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let first = app.buttons.matching(identifier: "destinationMatch").firstMatch
        for query in ["上野駅", "東京駅", "大阪駅", "金沢駅"] {
            field.tap()
            clearSearch(field)
            field.typeText(query)
            let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", query), object: first)
            XCTAssertEqual(XCTWaiter().wait(for: [named], timeout: 40), .completed,
                           "First candidate for \(query) must be named for it")
            let keyboard = app.keyboards.firstMatch
            XCTAssertTrue(keyboard.exists)
            XCTAssertTrue(first.isHittable)
            XCTAssertLessThanOrEqual(first.frame.maxY, keyboard.frame.minY, "\(query) candidate hidden by keyboard")
            screenshot("13-candidates-\(query)")
        }
        first.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
        scrollForegroundListTo(app.buttons["refreshDestination"])
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "金沢駅")).firstMatch.exists,
                      "Selected destination stays shown")
    }

    /// Real MapKit destination browsing remains usable when this Simulator has no GPS fix.
    private func establishPublishedArea() {
        // At accessibility sizes, List may not create a result row until it is scrolled into view.
        // The actual loaded count summary also proves that the public-area sync finished.
        let summary = app.descendants(matching: .any)["nearbySheetSummary"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.resultRows.firstMatch.exists || summary.exists
        }, object: nil)
        if XCTWaiter().wait(for: [ready], timeout: 30) == .completed { return }
        let field = destinationSearch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        clearSearch(field)
        field.typeText("上")
        field.typeText("野駅")
        let match = taitoDestinationMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40), "Actual MapKit destination required")
        match.tap()
        waitForVisualDestinationResults()
    }

    private func clearSearch(_ field: XCUIElement) {
        if let value = field.value as? String, value != field.placeholderValue, !value.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
    }

    private var taitoDestinationMatch: XCUIElement {
        // Live MapKit ranking/interim answers vary; Uenoshiba is not the public Taito test area.
        app.buttons.matching(identifier: "destinationMatch").matching(NSPredicate(
            format: "label BEGINSWITH %@ AND label CONTAINS %@", "上野駅", "台東"
        )).firstMatch
    }

    private func waitForVisualDestinationResults() {
        // On a small screen at AX5 the refresh row is lazy and below the long destination note.
        scrollForegroundListTo(app.buttons["refreshDestination"])
        scrollForegroundListTo(resultRows.firstMatch)
    }

    func testEmptyFilterStateHasReachableRecovery() {
        launch()
        establishPublishedArea()
        app.buttons["絞り込み"].tap()
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '場所の種類'")).firstMatch
        scrollForegroundListTo(picker)
        // iOS 18 exposes the Form row as a button around the actual Menu button.
        let menu = picker.buttons.firstMatch
        let menuButton: XCUIElement
        if #available(iOS 26, *) {
            menuButton = picker
        } else {
            menuButton = menu.exists ? menu : picker
        }
        scrollForegroundListTo(menuButton)
        menuButton.tap()
        let type = app.buttons["公共の喫煙室"]
        XCTAssertTrue(type.waitForExistence(timeout: 5))
        type.tap()
        app.buttons["完了"].tap()
        let clear = app.buttons["絞り込みを解除"]
        scrollTo(clear)
        screenshot("05-zero-filtered")
        clear.tap()
        waitForResults()
        screenshot("06-multiple-restored")
        XCTAssertFalse(resultRows.firstMatch.label.isEmpty)
        assertNoDeveloperText()
    }

    /// Uses the real OS setting; capture both its switch and the app, then restore the original value.
    func testReducedTransparencySheetIsReadable() throws {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launchArguments = ["-AppleLanguages", "(ja)", "-AppleLocale", "ja_JP"]
        settings.launch()
        // Settings restores its last page between audit runs; return through its own back controls.
        for name in ["画面表示とテキストサイズ", "Display & Text Size", "アクセシビリティ", "Accessibility"] {
            if settings.navigationBars[name].exists { settings.navigationBars.buttons.firstMatch.tap() }
        }
        settingsRow(in: settings, japanese: "アクセシビリティ", english: "Accessibility").tap()
        settingsRow(in: settings, japanese: "画面表示とテキストサイズ", english: "Display & Text Size").tap()
        let toggle = settings.switches.matching(NSPredicate(
            format: "label == %@ OR label == %@", "透明度を下げる", "Reduce Transparency"
        )).firstMatch
        for _ in 0..<8 {
            if toggle.exists && toggle.isHittable { break }
            settings.swipeUp()
        }
        XCTAssertTrue(toggle.exists && toggle.isHittable)
        let original = try XCTUnwrap(toggle.value as? String)
        addTeardownBlock {
            settings.activate()
            if toggle.value as? String != original {
                toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
            }
            let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", original), object: toggle)
            XCTAssertEqual(XCTWaiter().wait(for: [restored], timeout: 5), .completed, "Restore the real OS setting")
        }
        if original == "0" {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        }
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: toggle)
        XCTAssertEqual(XCTWaiter().wait(for: [enabled], timeout: 5), .completed)
        sleep(1) // Let the system repaint its labels after the appearance setting changes.
        let settingCapture = XCTAttachment(screenshot: settings.screenshot())
        settingCapture.name = "10-reduce-transparency-enabled"
        settingCapture.lifetime = .keepAlways
        add(settingCapture)
        launch()
        let title = app.navigationBars["近くの場所"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        screenshot("11-solid-sheet-medium")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)))
        sleep(1)
        screenshot("12-solid-sheet-large")
        XCTAssertTrue(destinationSearch.isHittable)
        assertNoDeveloperText()
    }

    private func settingsRow(in settings: XCUIApplication, japanese: String, english: String) -> XCUIElement {
        let row = settings.staticTexts.matching(NSPredicate(format: "label == %@ OR label == %@", japanese, english)).firstMatch
        for _ in 0..<8 {
            if row.exists && row.isHittable { break }
            settings.swipeUp()
        }
        XCTAssertTrue(row.exists && row.isHittable, "Actual Settings row: \(japanese)")
        return row
    }

    private func scrollForegroundListTo(_ element: XCUIElement) {
        // Drive the foreground list itself; a left-edge drag can miss an inset sheet or its Form.
        // Preserve a time-bounded async-data wait as well as a bounded number of gestures.
        let deadline = Date().addingTimeInterval(40)
        var gestures = 0
        while Date() < deadline {
            if element.exists && element.isHittable { return }
            if gestures < 12, let form = app.collectionViews.allElementsBoundByIndex.last {
                form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                    .press(forDuration: 0.05, thenDragTo: form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
                gestures += 1
            }
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                element.exists && element.isHittable
            }, object: nil)
            let remaining = deadline.timeIntervalSinceNow
            if remaining > 0, XCTWaiter().wait(for: [ready], timeout: min(1, remaining)) == .completed { return }
        }
        XCTAssertTrue(element.exists && element.isHittable)
    }
}
