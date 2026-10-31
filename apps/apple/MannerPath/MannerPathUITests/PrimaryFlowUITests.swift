import XCTest

/// The three primary flows, checked by their outcome: find a place and hand off walking directions to Apple Maps,
/// choose and clear a walking destination, and start a report of an unlisted place from the device location.
/// Against the local Worker corpus (Taito location) and the DEBUG-only destination and report stacks; nothing is sent.
final class N_PrimaryFlowUITests: MannerPathUITestCase {
    private let maps = XCUIApplication(bundleIdentifier: "com.apple.Maps")
    private static let largeText = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]

    private var directions: XCUIElement { app.buttons["selectedSpotDirections"] }

    /// Walking directions really open Apple Maps; the app is brought back for the next step.
    private func assertDirectionsOpenAppleMaps(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(["この場所へ案内", "この付近へ案内"].contains(directions.label), directions.label, file: file, line: line)
        XCTAssertGreaterThanOrEqual(directions.frame.height, 44, file: file, line: line)
        directions.tap()
        XCTAssertTrue(maps.wait(for: .runningForeground, timeout: 20), "Apple Maps did not open", file: file, line: line)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), file: file, line: line)
    }

    func testListRowShowsConditionsAndLeadsToDirections() {
        launch()
        waitForResults()
        let first = resultRows.firstMatch
        scrollTo(first)
        let name = first.label
        first.tap()
        // The row selects its place instead of pushing details: summary first, with what the place is and who may use it.
        XCTAssertTrue(directions.waitForExistence(timeout: 10), "A row must lead to directions")
        XCTAssertFalse(app.descendants(matching: .any)["spot-detail"].exists, "A row no longer pushes details")
        let summary = app.descendants(matching: .any)["selectedSpotSummary"]
        XCTAssertTrue(summary.staticTexts[name].exists, "Summary is not about the tapped row \(name)")
        XCTAssertTrue(app.staticTexts["selectedSpotConditions"].label.contains("利用条件"))
        scrollTo(directions, upwards: true)
        screenshot("primary-01-row-selected")
        assertDirectionsOpenAppleMaps()
        // Details stay one explicit step further.
        let details = app.buttons["selectedSpotDetails"]
        scrollTo(details, upwards: true)
        details.tap()
        waitForDetail()
        XCTAssertTrue(app.navigationBars[name].exists)
    }

    func testPinDirectionsAreReachableAtMedium() throws {
        try checkPinDirections(largeText: false)
    }

    func testPinDirectionsAreReachableWithLargestText() throws {
        try checkPinDirections(largeText: true)
    }

    private func checkPinDirections(largeText: Bool) throws {
        launch(extraArguments: largeText ? Self.largeText : [])
        waitForResults()
        _ = try selectPin()
        // At accessibility sizes the summary needs the full sheet; medium would leave directions under Clear selection.
        waitForSheet(largeText ? Self.largeSheet : Self.mediumSheet, "A pin shows its summary")
        XCTAssertTrue(directions.waitForExistence(timeout: 10))
        // Without scrolling: the selection scrolls the summary to the top of the medium sheet.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: directions)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 10), .completed, "Directions hidden after selecting a pin")
        XCTAssertLessThanOrEqual(directions.frame.maxY, app.buttons["clearSelectedSpot"].frame.minY,
                                 "Directions sit behind the Clear selection bar")
        screenshot("primary-02-pin-directions-\(largeText ? "ax5" : "normal")")
        assertDirectionsOpenAppleMaps()
    }

    func testDestinationClearsFromTheTopAndSearchesAgain() {
        checkDestinationClear(largeText: false)
    }

    func testDestinationClearsFromTheTopWithLargestText() {
        checkDestinationClear(largeText: true)
    }

    private func chooseDestination(_ query: String) {
        destinationSearch.tap()
        if let value = destinationSearch.value as? String, value != destinationSearch.placeholderValue, !value.isEmpty {
            destinationSearch.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        destinationSearch.typeText(query)
        let match = app.buttons.matching(identifier: "destinationMatch")
            .matching(NSPredicate(format: "label BEGINSWITH %@", "\(query)駅")).firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 15), "No destination candidate for \(query)")
        match.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
    }

    private func checkDestinationClear(largeText: Bool) {
        // The DEBUG destination provider attaches no place corpus; the destination itself is what is checked here.
        launch(extraArguments: ["-uiTestDestinationSearch", "progressive"] + (largeText ? Self.largeText : []))
        XCTAssertTrue(destinationSearch.waitForExistence(timeout: 10))
        chooseDestination("上野")
        let clear = app.buttons["clearDestination"]
        XCTAssertTrue(clear.waitForExistence(timeout: 10))
        // Named and clearable above the list, without scrolling to its end.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: clear)
        XCTAssertEqual(XCTWaiter().wait(for: [ready], timeout: 10), .completed, "Clear is not reachable without scrolling")
        XCTAssertGreaterThanOrEqual(clear.frame.height, 44)
        XCTAssertTrue(app.descendants(matching: .any)["destinationBar"].staticTexts["目的地: 上野駅"].exists)
        screenshot("primary-03-destination-bar-\(largeText ? "ax5" : "normal")")
        clear.tap()
        // The outcome: no destination, and the list is about the device location again.
        XCTAssertTrue(clear.waitForNonExistence(timeout: 10))
        XCTAssertFalse(app.buttons["refreshDestination"].exists)
        XCTAssertFalse(textContaining("目的地: ").exists)
        // Search again: a new destination replaces nothing stale.
        chooseDestination("東京")
        XCTAssertTrue(clear.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["destinationBar"].staticTexts["目的地: 東京駅"].exists)
        screenshot("primary-04-destination-again-\(largeText ? "ax5" : "normal")")
    }

    func testReportEntryIsTopTrailingAndStaysReachableWhileSearching() {
        launch(extraArguments: ["-uiTestPhotoReport", "success"])
        let mapEntry = app.buttons["mapReportButton"]
        XCTAssertTrue(mapEntry.waitForExistence(timeout: 90))
        waitForSheet(Self.mediumSheet, "Initial medium sheet")
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThan(mapEntry.frame.midX, window.midX, "The report entry sits top trailing")
        XCTAssertLessThan(mapEntry.frame.maxY, window.height * 0.3)
        XCTAssertTrue(mapEntry.label.contains("喫煙所を追加"))
        destinationSearch.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        let searchEntry = app.buttons["searchReportButton"]
        XCTAssertTrue(searchEntry.waitForExistence(timeout: 10), "No report entry while searching")
        XCTAssertTrue(searchEntry.isHittable)
        XCTAssertLessThanOrEqual(searchEntry.frame.maxY, keyboard.frame.minY, "Entry hidden by the keyboard")
        XCTAssertTrue(searchEntry.label.contains("喫煙所を追加"))
        screenshot("primary-05-search-report-entry")
        searchEntry.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["report.newPlace.introduction"].exists)
        discardReportDraft()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForNonExistence(timeout: 10))
    }

    func testPausedEntryIsFoundWhileSearchingAndOnlyExplainsThePause() {
        launch(extraArguments: ["-uiTestPhotoReport", "closed"])
        let mapEntry = app.buttons["mapReportButton"]
        XCTAssertTrue(mapEntry.waitForExistence(timeout: 90))
        waitForSheet(Self.mediumSheet, "Initial medium sheet")
        XCTAssertTrue(mapEntry.label.contains("新規申請の受付停止中"), mapEntry.label)
        XCTAssertGreaterThanOrEqual(mapEntry.frame.height, 44)
        destinationSearch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        let searchEntry = app.buttons["searchReportButton"]
        XCTAssertTrue(searchEntry.waitForExistence(timeout: 10), "No paused entry while searching")
        // One entry at a time, so VoiceOver never reads two.
        XCTAssertFalse(mapEntry.exists)
        XCTAssertFalse(app.buttons["sheetReportButton"].exists)
        XCTAssertTrue(searchEntry.label.contains("新規申請の受付停止中"))
        screenshot("primary-08-paused-search-entry")
        searchEntry.tap()
        assertIntakePausedAlert()
    }

    func testSavedDraftReopensWhileIntakeIsPaused() {
        // A draft saved while intake was open keeps its own gate: it reopens, and its form still refuses to send.
        launch(extraArguments: ["-uiTestPhotoReport", "success", "-uiTestReportPersistent", "YES", "-uiTestReportReset", "YES"])
        let mapEntry = app.buttons["mapReportButton"]
        XCTAssertTrue(mapEntry.waitForExistence(timeout: 90))
        waitForSheet(Self.mediumSheet, "Initial medium sheet")
        mapEntry.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        // Opening the form already saves the new-place draft on the device.
        app.terminate()
        launch(extraArguments: ["-uiTestPhotoReport", "closed", "-uiTestReportPersistent", "YES"])
        XCTAssertTrue(mapEntry.waitForExistence(timeout: 90))
        waitForSheet(Self.mediumSheet, "Relaunched medium sheet")
        XCTAssertTrue(mapEntry.label.contains("保存済みの報告を再開"), mapEntry.label)
        mapEntry.tap()
        XCTAssertFalse(app.alerts["現在、申請受付を停止しています"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["report-new-spot-closed"].waitForExistence(timeout: 10))
        let submit = app.buttons["report.submit"]
        XCTAssertFalse(submit.exists && submit.isEnabled, "A paused deployment must not accept the draft")
        discardReportDraft()
    }

    func testCurrentLocationIsOfferedAndBecomesAPinOnlyWhenChosen() {
        launch(extraArguments: ["-uiTestPhotoReport", "success"])
        waitForResults()
        let mapEntry = app.buttons["mapReportButton"]
        XCTAssertTrue(mapEntry.waitForExistence(timeout: 30))
        mapEntry.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        let choose = app.buttons["report.pin.choose"]
        scrollTo(choose)
        choose.tap()
        let useCurrent = app.buttons["report.pin.useCurrentLocation"]
        // With only an older fix the picker first offers to find the location; that tap asks for a fresh fix only.
        let request = app.buttons["report.pin.requestLocation"]
        if !useCurrent.waitForExistence(timeout: 5), request.exists {
            XCTAssertFalse(app.buttons["report.pin.confirm"].exists)
            request.tap()
        }
        XCTAssertTrue(useCurrent.waitForExistence(timeout: 20), "Use current location is not offered")
        scrollTo(useCurrent)
        XCTAssertGreaterThanOrEqual(useCurrent.frame.height, 44)
        // Accuracy is stated, and nothing is chosen for the user before the tap.
        XCTAssertTrue(app.staticTexts["report.pin.currentLocationAccuracy"].label.contains("現在地の精度: 約"))
        let confirm = app.buttons["report.pin.confirm"]
        XCTAssertFalse(confirm.exists, "A pin was selected before the user chose one")
        useCurrent.tap()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        screenshot("primary-06-current-location-pin")
        // The user can still adjust it before confirming.
        XCTAssertTrue(app.buttons["report.pin.useCenter"].exists)
        scrollTo(confirm)
        confirm.tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForNonExistence(timeout: 10))
        // The confirmed pin is the simulated location (35.7118, 139.7775), quantized; nothing has been sent.
        let selected = app.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS %@", "35.71")).firstMatch
        XCTAssertTrue(selected.waitForExistence(timeout: 5), "The form does not hold the chosen pin")
        XCTAssertFalse(app.descendants(matching: .any)["report.pendingReview"].exists, "Nothing may be sent by choosing")
        screenshot("primary-07-current-location-confirmed")
        discardReportDraft()
    }
}
