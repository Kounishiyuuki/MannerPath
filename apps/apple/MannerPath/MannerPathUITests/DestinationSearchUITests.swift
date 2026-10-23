import XCTest

/// Real search field/model/ranking/keyboard; deterministic DEBUG provider, no Worker or MapKit response required.
/// Captures are synthetic test evidence, never App Store assets.
final class DestinationSearchUITests: MannerPathUITestCase {
    private func type(_ query: String, scenario: String = "progressive") {
        launch(extraArguments: ["-uiTestDestinationSearch", scenario])
        XCTAssertTrue(destinationSearch.waitForExistence(timeout: 10))
        destinationSearch.tap()
        destinationSearch.typeText(query) // Deliberately no return/search key.
    }

    private func candidate(_ title: String) -> XCUIElement {
        app.buttons.matching(identifier: "destinationMatch")
            .matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    private func assertAboveKeyboard(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        assertDestinationCandidateAboveKeyboard(element, file: file, line: line)
    }

    private func waitForFirstCandidate(_ name: String) {
        let first = app.buttons.matching(identifier: "destinationMatch").firstMatch
        let ordered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", name), object: first)
        XCTAssertEqual(XCTWaiter().wait(for: [ordered], timeout: 15), .completed)
    }

    private func select(_ element: XCUIElement, name: String) {
        assertAboveKeyboard(element)
        element.tap() // One tap, no search submission or retry.
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
        // No smoking-place corpus is attached: verify destination selection independently of nearby spot loading.
        let selected = app.buttons["refreshDestination"]
        scrollTo(selected)
        XCTAssertTrue(textContaining(name).exists)
        screenshot("fixture-only-destination-selected-not-for-submission")
    }

    func testTypingListsSeveralConcretePlacesAndOneTapSelects() {
        type("上野")
        let station = candidate("上野駅")
        XCTAssertTrue(station.waitForExistence(timeout: 15))
        XCTAssertTrue(candidate("上野恩賜公園").waitForExistence(timeout: 10))
        waitForFirstCandidate("上野駅")
        // Assert known concrete fixture identities, not XCUI's lazy row count or a live provider's cardinality.
        assertAboveKeyboard(station)
        screenshot("fixture-only-ueno-concrete-candidates-not-for-submission")
        select(station, name: "上野駅")
    }

    func testOneCandidateIsSelectableWithKeyboardOpen() {
        type("上野", scenario: "single")
        let station = candidate("上野駅")
        XCTAssertTrue(station.waitForExistence(timeout: 15))
        select(station, name: "上野駅")
    }

    func testCandidatesFollowEachNewQuery() {
        type("上野")
        XCTAssertTrue(candidate("上野駅").waitForExistence(timeout: 15))
        for query in ["東京", "大阪", "金沢"] {
            let field = destinationSearch
            let value = field.value as? String ?? ""
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
            field.typeText(query)
            XCTAssertTrue(candidate("\(query)駅").waitForExistence(timeout: 15))
            waitForFirstCandidate("\(query)駅")
            assertAboveKeyboard(candidate("\(query)駅"))
        }
        XCTAssertFalse(candidate("上野駅").exists)
        select(candidate("金沢駅"), name: "金沢駅")
    }

    func testKeyboardSearchKeyKeepsFallbackResultSelectable() {
        type("上野", scenario: "fallback")
        destinationSearch.typeText("\n")
        let station = candidate("上野駅")
        XCTAssertTrue(station.waitForExistence(timeout: 15))
        // Pressing Search may dismiss the keyboard; typing-only tests above require it to remain open.
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: station)
        XCTAssertEqual(XCTWaiter().wait(for: [visible], timeout: 15), .completed)
        station.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10))
        scrollTo(app.buttons["refreshDestination"])
        XCTAssertTrue(textContaining("上野駅").exists)
    }

    func testEmptyResponseHasHonestEmptyState() {
        type("上野", scenario: "empty")
        XCTAssertTrue(textContaining("一致する目的地").waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons.matching(identifier: "destinationMatch").firstMatch.exists)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
    }

    func testUnavailableResponseHasHonestFailureState() {
        type("上野", scenario: "failure")
        XCTAssertTrue(textContaining("目的地を検索できません").waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons.matching(identifier: "destinationMatch").firstMatch.exists)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
    }
}
