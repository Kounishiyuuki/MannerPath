import XCTest

/// Same real app, public fixed test location and flow before/after. No app-only test hooks or search replacement.
@MainActor
final class NativeSearchSheetUITests: MannerPathUITestCase {
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
        let match = app.buttons.matching(identifier: "destinationMatch").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40), "MapKit must provide actual candidates for this visual comparison")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertTrue(match.isHittable)
        XCTAssertGreaterThanOrEqual(match.frame.height, 44)
        XCTAssertFalse(match.label.isEmpty)
        screenshot("03-candidates")
        match.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "Selecting a destination ends system search")
        waitForDestinationResults()
        XCTAssertTrue(resultRows.firstMatch.exists)
        screenshot("04-destination-selected")
        assertNoDeveloperText()
    }

    /// Real MapKit destination browsing remains usable when this Simulator has no GPS fix.
    private func establishPublishedArea() {
        if resultRows.firstMatch.waitForExistence(timeout: 5) { return }
        let field = destinationSearch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        clearSearch(field)
        field.typeText("上野駅")
        let match = app.buttons.matching(identifier: "destinationMatch").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 40), "Actual MapKit destination required")
        match.tap()
        waitForDestinationResults()
    }

    private func clearSearch(_ field: XCUIElement) {
        if let value = field.value as? String, value != field.placeholderValue, !value.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
    }

    func testEmptyFilterStateHasReachableRecovery() {
        launch()
        establishPublishedArea()
        app.buttons["絞り込み"].tap()
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '場所の種類'")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        app.buttons["公共の喫煙室"].tap()
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
}
