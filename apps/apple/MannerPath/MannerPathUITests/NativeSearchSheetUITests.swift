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
        // With the Worker, listed places lead the results, so the first candidate can start below the keyboard.
        guard let candidate = reachUsableDestinationMatch(fullyVisible: true, "Live MapKit candidate") else { return }
        XCTAssertFalse(candidate.label.isEmpty)
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
    /// sheet alone, search candidates stay above the keyboard, and the sheet on screen collapses again after search.
    func testCollapsedSheetKeepsSearchAndListReachable() {
        launch()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        waitForSheet(Self.mediumSheet, "Sheet does not start at medium")
        let window = app.windows.firstMatch.frame
        // At accessibility text sizes collapsed is taller than at default, so measure it against medium: at least
        // 60 points lower, which leaves the map visibly larger at any text size.
        let collapsed = ((app.navigationBars["近くの場所"].frame.minY + 60) / window.height)...1
        dragSheet(to: 0.98, settlingIn: collapsed, "Sheet did not collapse")
        let showList = app.buttons["showNearbyList"]
        for element in [destinationSearch, showList] {
            XCTAssertTrue(element.waitForExistence(timeout: 5) && element.isHittable, "\(element) is not reachable")
            XCTAssertTrue(window.contains(element.frame), "\(element) is clipped at \(element.frame)")
            XCTAssertGreaterThanOrEqual(element.frame.height, 36)
        }
        XCTAssertGreaterThanOrEqual(showList.frame.height, 44)
        XCTAssertFalse(resultRows.firstMatch.exists, "Collapsed sheet still shows the list")
        XCTAssertFalse(app.descendants(matching: .any)["nearbySheetSummary"].exists,
                       "The list under the collapsed sheet is still in the accessibility tree")
        screenshot("20-sheet-collapsed")

        // Panning the map must not grow the sheet.
        nearbyMap.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            .press(forDuration: 0.05, thenDragTo: nearbyMap.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.2)))
        waitForSheet(collapsed, "Panning the map expanded the sheet")

        showList.tap()
        waitForSheet(Self.mediumSheet, "Show List did not return to medium")
        XCTAssertFalse(showList.exists)

        // Search from collapsed: iOS lifts the sheet over the keyboard and the candidates stay usable above it.
        dragSheet(to: 0.98, settlingIn: collapsed, "Sheet did not collapse again")
        searchUeno()
        screenshot("21-collapsed-search-candidates")
        endSearch()
        waitForSheet(collapsed, "Ending search did not bring back the collapsed sheet on screen")
        XCTAssertTrue(showList.waitForExistence(timeout: 5) && showList.isHittable)
        screenshot("22-collapsed-after-search")

        // Search from medium, end it, then drag the sheet down to collapsed by hand.
        showList.tap()
        waitForSheet(Self.mediumSheet, "Show List did not return to medium")
        searchUeno()
        endSearch()
        waitForSheet(Self.mediumSheet, "Ending search did not bring back the medium sheet on screen")
        dragSheet(to: 0.98, settlingIn: collapsed, "Sheet did not collapse after search ended")
        XCTAssertTrue(showList.waitForExistence(timeout: 5) && showList.isHittable)

        // A query still in the field: pulling the sheet down from its grabber puts the keyboard away and collapses it.
        showList.tap()
        waitForSheet(Self.mediumSheet, "Show List did not return to medium")
        searchUeno()
        dragSheet(to: 0.98, settlingIn: collapsed, "Sheet with a query did not collapse")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Collapsing left the keyboard up")
        XCTAssertTrue(destinationSearch.isHittable)
        let after = XCTAttachment(string: "query after collapse: \(String(describing: destinationSearch.value)), "
            + "showList: \(showList.exists)\n\(app.debugDescription)")
        after.name = "\(phase)-collapsed-with-query-tree"
        after.lifetime = .keepAlways
        add(after)
        screenshot("23-collapsed-with-query")
    }

    /// The Search key expands the sheet for the results; afterwards the sheet on screen still follows the reader's
    /// drags to collapsed and back to medium (no detent left out of step with the screen).
    func testSearchKeyKeepsSheetInStepWithDrags() {
        launch()
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        waitForSheet(Self.mediumSheet, "Sheet does not start at medium")
        searchUeno()
        destinationSearch.typeText("\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Search key left the keyboard up")
        waitForSheet(Self.largeSheet, "Search key did not show the results at large")
        screenshot("25-search-key-results")
        dragSheet(to: 0.98, settlingIn: Self.collapsedSheet, "Sheet did not collapse after the Search key")
        screenshot("26-search-key-collapsed")
        dragSheet(to: 0.55, settlingIn: Self.mediumSheet, "Sheet did not return to medium after the Search key")
    }

    /// AX5 (forced for this app only): a result row there can be taller than the space above the keyboard, and listed
    /// places lead the results, so MapKit candidates start off screen. The first row must still be tappable and lead
    /// to its place; a MapKit candidate is reached by scrolling and selected; the three detents still work afterwards.
    func testLargeTextSearchCandidatesCanBeReachedAndSelected() {
        launch(extraArguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 10))
        waitForSheet(Self.mediumSheet, "Sheet does not start at medium")
        let window = app.windows.firstMatch.frame
        let collapsed = ((app.navigationBars["近くの場所"].frame.minY + 60) / window.height)...1
        dragSheet(to: 0.98, settlingIn: collapsed, "Sheet did not collapse")

        // The first row, whichever kind leads, opens what it names.
        searchUeno(largeText: true)
        screenshot("27-large-text-first-candidate")
        // The topmost row actually usable on screen; query order is not screen order (on iOS 18.6 the first match
        // was a MapKit candidate below the keyboard while a listed place led on screen).
        guard let first = searchResultRows.allElementsBoundByIndex.filter(usableAboveKeyboard)
            .min(by: { $0.frame.minY < $1.frame.minY }) else {
            return XCTFail("No search result is usable between the search field and the keyboard")
        }
        let firstIsPlace = first.identifier == "publishedSpotMatch"
        first.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Choosing a candidate left the keyboard up")
        if firstIsPlace {
            waitForDetail()
            app.navigationBars.buttons.element(boundBy: 0).tap()
            waitForSheet(Self.mediumSheet, "Back from the detail did not return to medium")
        } else {
            assertDestinationSelected()
        }

        // A MapKit candidate below the listed places: scroll the results above the keyboard, then select it.
        searchUeno(largeText: true)
        guard let candidate = reachUsableDestinationMatch(fullyVisible: false, "MapKit candidate") else { return }
        screenshot("28-large-text-mapkit-candidate")
        candidate.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Choosing a destination left the keyboard up")
        assertDestinationSelected()

        // The detents still follow drags and Show List after both selections.
        dragSheet(to: 0.98, settlingIn: collapsed, "Sheet did not collapse after selection")
        let showList = app.buttons["showNearbyList"]
        XCTAssertTrue(showList.waitForExistence(timeout: 5) && showList.isHittable)
        showList.tap()
        waitForSheet(Self.mediumSheet, "Show List did not return to medium")
        dragSheet(to: 0.05, settlingIn: Self.largeSheet, "Sheet did not expand")
    }

    /// The list shows the chosen destination. Searching from collapsed returns to collapsed, where the list is
    /// behind Show List, so open it first.
    private func assertDestinationSelected(file: StaticString = #filePath, line: UInt = #line) {
        let showList = app.buttons["showNearbyList"]
        let selected = app.buttons["refreshDestination"]
        // The sheet settles after the keyboard leaves: either back to collapsed (Show List) or with the list on screen.
        // A fixed short wait missed a slow collapse on iOS 18.6 at AX5.
        _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 10)
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            showList.exists || self.onScreenAndHittable(selected)
        }, object: nil)
        _ = XCTWaiter().wait(for: [settled], timeout: 10)
        if showList.exists {
            showList.tap()
            waitForSheet(Self.mediumSheet, "Show List did not return to medium after selection")
        }
        scrollForegroundListTo(selected)
        XCTAssertTrue(onScreenAndHittable(selected), "The chosen destination is not shown", file: file, line: line)
    }

    private var searchResultRows: XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "identifier IN %@", ["publishedSpotMatch", "destinationMatch"]))
    }

    /// The bottom of the area results can be used in: the keyboard, or a toolbar below the search field, or the
    /// screen bottom.
    private var usableBottom: CGFloat {
        let top = destinationSearch.frame.maxY
        let bars = [app.keyboards.firstMatch] + app.toolbars.allElementsBoundByIndex
        return bars.filter { $0.exists && $0.frame.minY > top }.map(\.frame.minY)
            .reduce(app.windows.firstMatch.frame.maxY, min)
    }

    /// Tappable with at least a 44 pt band visible between the search field and the keyboard or bars.
    /// Frames are checked first: on iOS 18.6 asking `isHittable` of a row scrolled off screen records a failure
    /// ("Activation point invalid") instead of answering false.
    private func usableAboveKeyboard(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        return element.frame.minY >= destinationSearch.frame.maxY - 1 && element.frame.minY + 44 <= usableBottom
            && element.isHittable
    }

    /// Whole, at least 44 pt tall, between the search field and the keyboard or bars: the default-size requirement.
    private func fullyUsableAboveKeyboard(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        return element.frame.height >= 44 && element.frame.minY >= destinationSearch.frame.maxY
            && element.frame.maxY <= usableBottom && element.isHittable
    }

    /// Whichever MapKit candidate is usable on screen, scrolling the results toward it when none is yet. The order and
    /// the scroll distance come from the hierarchy, never from fixed values: listed places may lead and push the
    /// candidates below the keyboard. Fails (with the hierarchy attached) when no candidate becomes usable.
    private func reachUsableDestinationMatch(fullyVisible: Bool, _ what: String,
                                             file: StaticString = #filePath, line: UInt = #line) -> XCUIElement? {
        let usable = fullyVisible ? fullyUsableAboveKeyboard : usableAboveKeyboard
        let matches = app.buttons.matching(identifier: "destinationMatch")
        func current() -> XCUIElement? { matches.allElementsBoundByIndex.first(where: usable) }
        let window = app.windows.firstMatch.frame
        for attempt in 0...12 {
            let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in current() != nil }, object: nil)
            if XCTWaiter().wait(for: [visible], timeout: attempt == 0 ? 15 : 3) == .completed, let found = current() {
                return found
            }
            guard attempt < 12 else { break }
            // A drag shorter than the usable band, held at its end so no fling skips a row past the band. Start above
            // the keyboard's own bar, which would take the drag.
            let top = destinationSearch.frame.maxY, bottom = usableBottom
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: window.midX, dy: bottom - 60))
                .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: window.midX, dy: max(top + 20, bottom - 60 - (bottom - top) * 0.6))),
                       withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        screenshot("candidate-not-usable")
        let frames = matches.allElementsBoundByIndex.map { String(describing: $0.frame) }.joined(separator: ", ")
        let tree = XCTAttachment(string: "field=\(destinationSearch.frame), bottom=\(usableBottom), matches=[\(frames)]\n"
            + app.debugDescription)
        tree.name = "\(phase)-candidate-not-usable-tree"
        tree.lifetime = .keepAlways
        add(tree)
        XCTFail("No \(what) became usable between the search field and the keyboard", file: file, line: line)
        return nil
    }

    private func assertUsableAboveKeyboard(_ element: XCUIElement, _ what: String,
                                           file: StaticString = #filePath, line: UInt = #line) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.usableAboveKeyboard(element) }, object: nil)
        guard XCTWaiter().wait(for: [ready], timeout: 15) != .completed else { return }
        screenshot("candidate-not-usable")
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "\(phase)-candidate-not-usable-tree"
        tree.lifetime = .keepAlways
        add(tree)
        XCTFail("\(what) is not usable above the keyboard: \(element.exists ? String(describing: element.frame) : "missing")",
                file: file, line: line)
    }

    /// Types a destination and waits for a live MapKit candidate fully above the keyboard. At accessibility sizes a
    /// row may be taller than the space there, so the first row of either kind only needs a usable band.
    private func searchUeno(largeText: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        destinationSearch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), file: file, line: line)
        clearSearch(destinationSearch)
        destinationSearch.typeText("上野")
        if largeText || phase == "large-text" {
            let first = searchResultRows.firstMatch
            XCTAssertTrue(first.waitForExistence(timeout: 45), "No search result", file: file, line: line)
            assertUsableAboveKeyboard(first, "First search result", file: file, line: line)
            return
        }
        let candidates = app.buttons.matching(identifier: "destinationMatch")
        XCTAssertTrue(candidates.firstMatch.waitForExistence(timeout: 45), "No live MapKit candidate", file: file, line: line)
        // Listed places can lead, so the first candidate in the hierarchy may be below the keyboard.
        _ = reachUsableDestinationMatch(fullyVisible: true, "MapKit candidate", file: file, line: line)
    }

    /// The system control that ends search: Cancel on iOS 18, a Close button on iOS 26 (both in the accessibility tree).
    private func endSearch(file: StaticString = #filePath, line: UInt = #line) {
        let end = app.navigationBars["近くの場所"].buttons
            .matching(NSPredicate(format: "label == 'キャンセル' OR label == '閉じる'")).firstMatch
        XCTAssertTrue(end.waitForExistence(timeout: 5), "No system control to end search", file: file, line: line)
        end.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), file: file, line: line)
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
        let matches = app.buttons.matching(identifier: "destinationMatch")
        // Query order is not screen order: the first MapKit row on screen is the topmost one wholly between the
        // field and the keyboard. Frames are checked before hittability, which off-screen rows cannot answer.
        func topUsable() -> XCUIElement? {
            // The band is read once per check; re-reading it for every row made each poll slow enough to stall input.
            let top = destinationSearch.frame.maxY, bottom = usableBottom
            let inBand = matches.allElementsBoundByIndex.map { ($0, $0.frame) }
                .filter { $1.height >= 44 && $1.minY >= top && $1.maxY <= bottom }
            return inBand.min { $0.1.minY < $1.1.minY }.map(\.0).flatMap { $0.isHittable ? $0 : nil }
        }
        var first: XCUIElement?
        for query in ["上野駅", "東京駅", "大阪駅", "金沢駅"] {
            field.tap()
            clearSearch(field)
            field.typeText(query)
            let named = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                topUsable()?.label.hasPrefix(query) == true
            }, object: nil)
            XCTAssertEqual(XCTWaiter().wait(for: [named], timeout: 40), .completed,
                           "First candidate for \(query) must be named for it and wholly above the keyboard")
            XCTAssertTrue(app.keyboards.firstMatch.exists)
            first = topUsable()
            screenshot("13-candidates-\(query)")
        }
        guard let first else { return XCTFail("No usable candidate for 金沢駅") }
        first.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
        scrollForegroundListTo(app.buttons["refreshDestination"])
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "金沢駅")).firstMatch.exists,
                      "Selected destination stays shown")

        // The field is reusable after selection: a new query changes the destination, and Clear removes it.
        field.tap()
        clearSearch(field)
        field.typeText("東京駅")
        guard let next = reachUsableDestinationMatch(fullyVisible: true, "東京駅 candidate") else { return }
        next.tap()
        assertDestinationSelected()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "東京駅")).firstMatch.exists,
                      "Changed destination is shown")
        let clear = app.buttons["clearDestination"]
        scrollForegroundListTo(clear)
        clear.tap()
        XCTAssertTrue(app.buttons["refreshDestination"].waitForNonExistence(timeout: 10), "Clear removes the destination")
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

    /// The frame first: on iOS 18.6 `isHittable` of an element scrolled off screen records a failure instead of
    /// answering false.
    private func onScreenAndHittable(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let frame = element.frame
        return !frame.isEmpty && app.windows.firstMatch.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
            && element.isHittable
    }

    private func scrollForegroundListTo(_ element: XCUIElement) {
        // Drive the foreground list itself; a left-edge drag can miss an inset sheet or its Form.
        // Preserve a time-bounded async-data wait as well as a bounded number of gestures.
        let deadline = Date().addingTimeInterval(40)
        var gestures = 0
        var upward = false
        while Date() < deadline {
            if onScreenAndHittable(element) { return }
            // A drag at the list's top end moves the sheet instead; if that collapsed it, reopen it as a reader would.
            let showList = app.buttons["showNearbyList"]
            if showList.exists {
                showList.tap()
                waitForSheet(Self.mediumSheet, "Show List did not reopen the list while scrolling")
                continue
            }
            if gestures < 18, let form = app.collectionViews.allElementsBoundByIndex.last {
                // Toward the element when its frame says it is above the list; otherwise down until the list stops
                // moving at its end, then back up. A fixed turn after a few slow drags never reached the list bottom.
                let above = element.exists && !element.frame.isEmpty && element.frame.maxY <= form.frame.minY
                let (from, to) = above || upward ? (0.3, 0.85) : (0.85, 0.3)
                // One labelled row, found again by its label after the drag: `cells.firstMatch` named a different
                // recycled cell each time, so it could not tell a moving list from one stopped at its end. The lowest
                // one, since a section header pinned at the top stays put while the list moves.
                let anchor = form.staticTexts.allElementsBoundByIndex.last { !$0.label.isEmpty && form.frame.intersects($0.frame) }
                let anchorLabel = anchor?.label, before = anchor?.frame.minY
                form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: from))
                    // Slow and held at the end: a quick drag flung the list 300-480pt per gesture, past a row as tall
                    // as the visible band at AX5 (iOS 18.6), so alternating directions skipped it each way.
                    .press(forDuration: 0.05, thenDragTo: form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: to)),
                           withVelocity: .slow, thenHoldForDuration: 0.2)
                gestures += 1
                let again = anchorLabel.map { form.staticTexts.matching(NSPredicate(format: "label == %@", $0)).firstMatch }
                let after = again.flatMap { $0.exists ? $0.frame.minY : nil }
                if !above, let before, let after, abs(after - before) < 1 { upward.toggle() }
            }
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                self.onScreenAndHittable(element)
            }, object: nil)
            let remaining = deadline.timeIntervalSinceNow
            if remaining > 0, XCTWaiter().wait(for: [ready], timeout: min(1, remaining)) == .completed { return }
        }
        guard !onScreenAndHittable(element) else { return }
        screenshot("list-scroll-failure")
        let tree = XCTAttachment(string: "target=\(element.exists ? String(describing: element.frame) : "missing")\n"
            + app.debugDescription)
        tree.name = "\(phase)-list-scroll-failure-tree"
        tree.lifetime = .keepAlways
        add(tree)
        XCTFail("Could not scroll the list to \(element)")
    }
}
