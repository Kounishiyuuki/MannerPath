import Foundation
import XCTest

final class MannerPathWatch_Watch_AppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testFirstUseReachesNearby() throws {
        let app = try launch(scenario: "empty", eligible: false)
        XCTAssertTrue(app.staticTexts["Before you continue"].exists)
        XCTAssertTrue(app.staticTexts["In Japan, you must be at least 20 to smoke or enter a smoking area."].exists)
        attach(app, named: "watch-first-use")

        let button = app.buttons["watch-eligibility-continue"]
        scrollUntilHittable(button, in: app)
        button.tap()
        XCTAssertTrue(app.staticTexts["No saved places"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Open MannerPath on iPhone once to send nearby data to this Watch."].exists)
        attach(app, named: "watch-no-snapshot-after-eligibility")
    }

    @MainActor
    func testSavedResultsLeadAndOnlyTopThreeAppear() throws {
        let app = try launch(location: "current")
        let first = app.buttons["watch-spot-first"]
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        XCTAssertTrue(first.isHittable, "The nearest saved result should be visible without scrolling")
        XCTAssertTrue(first.label.contains("Ashtray location"))
        XCTAssertTrue(first.label.contains("current location"), "Actual row: \(first.label)")
        XCTAssertFalse(app.buttons["watch-spot-fourth"].exists)
        attach(app, named: "watch-nearby-current-location")

        app.swipeUp()
        XCTAssertTrue(app.buttons["watch-spot-third"].exists)
        XCTAssertTrue(app.buttons["watch-quick-filters"].exists)
        XCTAssertFalse(app.buttons["watch-spot-fourth"].exists)
        attach(app, named: "watch-nearby-last-action")
    }

    @MainActor
    func testStaleDetailKeepsDirectionsAheadOfSources() throws {
        let app = try launch(stale: true, location: "current")
        XCTAssertTrue(app.staticTexts["Saved places · old data"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["watch-spot-first"].label.contains("current location"),
                      "Actual row: \(app.buttons["watch-spot-first"].label)")
        attach(app, named: "watch-stale-snapshot-current-location")

        app.buttons["watch-spot-first"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "straight-line · current location"))
            .firstMatch.waitForExistence(timeout: 5))
        let oldData = app.staticTexts["Saved data is old. Open iPhone app to refresh."]
        scrollUntilHittable(oldData, in: app)
        let directions = app.descendants(matching: .any)["watch-directions"].firstMatch
        scrollUntilHittable(directions, in: app)
        XCTAssertTrue(directions.isEnabled)
        XCTAssertTrue(directions.isHittable, "Directions should precede source and attribution content")
        attach(app, named: "watch-detail-directions")

        scrollUntilHittable(app.staticTexts["Fixture publisher"], in: app)
        XCTAssertTrue(app.staticTexts["Source"].exists)
        attach(app, named: "watch-detail-source")
    }

    @MainActor
    func testQuickFiltersCanEmptyAndClearResults() throws {
        let app = try launch()
        let quickFilters = app.buttons["watch-quick-filters"]
        scrollUntilHittable(quickFilters, in: app)
        quickFilters.tap()
        XCTAssertTrue(app.staticTexts["Filters"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Tobacco"].exists)

        let tobacco = app.descendants(matching: .any)["watch-tobacco-filter"].firstMatch
        scrollUntilHittable(tobacco, in: app)
        tobacco.tap()
        let paper = app.buttons["Paper"]
        XCTAssertTrue(paper.waitForExistence(timeout: 5))
        paper.tap()
        XCTAssertTrue(tobacco.label.contains("Paper") || String(describing: tobacco.value ?? "").contains("Paper"))

        let confirmed = app.descendants(matching: .any)["watch-confirmed-support-filter"].firstMatch
        scrollUntilHittable(confirmed, in: app)
        XCTAssertTrue(confirmed.isEnabled)
        confirmed.tap()
        XCTAssertEqual(confirmed.value as? String, "1")

        let openNow = app.descendants(matching: .any)["watch-open-now-filter"].firstMatch
        scrollUntilHittable(openNow, in: app)
        XCTAssertTrue(app.staticTexts["Data"].exists)
        openNow.tap()
        XCTAssertEqual(openNow.value as? String, "1")
        attach(app, named: "watch-filters-selected")

        app.navigationBars.buttons.firstMatch.tap()
        let noResults = app.staticTexts["No saved places match these filters."]
        XCTAssertTrue(noResults.waitForExistence(timeout: 5))
        scrollUntilHittable(noResults, in: app, direction: .down)
        attach(app, named: "watch-filters-no-results")
        let clear = app.buttons["watch-clear-empty-filters"]
        scrollUntilHittable(clear, in: app)
        clear.tap()
        XCTAssertTrue(app.buttons["watch-spot-first"].waitForExistence(timeout: 5))
        attach(app, named: "watch-filters-cleared")
    }

    @MainActor
    func testLocationStatesNeverShowOldDistanceAsCurrent() throws {
        for state in ["none", "failed", "old"] {
            let app = try launch(location: state)
            let first = app.buttons["watch-spot-first"]
            XCTAssertTrue(first.waitForExistence(timeout: 5))
            XCTAssertTrue(first.label.contains("Distance needs location"), "Location state: \(state)")
            XCTAssertFalse(first.label.contains("current location"), "Location state: \(state)")
            attach(app, named: "watch-location-\(state)")
            app.terminate()
        }
    }

    @MainActor
    func testJapaneseStaleAndLocationCopy() throws {
        let app = try launch(stale: true, location: "failed", language: "ja")
        XCTAssertTrue(app.staticTexts["保存済みの場所 · 古い情報"].waitForExistence(timeout: 5))
        let first = app.buttons["watch-spot-first"]
        XCTAssertTrue(first.label.contains("距離: 現在地が必要"))
        attach(app, named: "watch-japanese-stale-no-location")
    }

    @MainActor
    private func launch(scenario: String = "snapshot", eligible: Bool = true, stale: Bool = false,
                        location: String = "none", language: String = "en") throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--mannerpath-watch-ui-test", "-AppleLanguages", "(\(language))",
                               "-AppleLocale", language == "ja" ? "ja_JP" : "en_US"]
        app.launchEnvironment["MANNERPATH_WATCH_UI_TEST_SCENARIO"] = scenario
        app.launchEnvironment["MANNERPATH_WATCH_UI_TEST_ELIGIBLE"] = eligible ? "yes" : "no"
        app.launchEnvironment["MANNERPATH_WATCH_UI_TEST_LOCATION"] = location
        if scenario == "snapshot" {
            app.launchEnvironment["MANNERPATH_WATCH_UI_TEST_SNAPSHOT"] = try fixture(stale: stale)
        }
        app.launch()
        return app
    }

    private func fixture(stale: Bool) throws -> String {
        let now = Date().timeIntervalSince1970
        func spot(_ id: String, _ name: String, _ longitude: Double, _ type: String,
                  _ paper: String) -> [String: Any] {
            ["id": id, "name": name, "latitude": 0.0, "longitude": longitude,
             "spotType": type, "accessType": "public", "supportsPaper": paper,
             "supportsHeated": "unknown", "lifecycle": "active",
             "evidenceQuality": "officialListing", "evidenceQualityVersion": "evidence-quality.v1",
             "lastVerifiedAt": now - 86_400, "sourceIDs": ["fixture"]]
        }
        let payload: [String: Any] = [
            "schemaVersion": 1, "revision": 1, "generatedAt": now - (stale ? 7_200 : 0),
            "snapshotID": UUID().uuidString,
            "spots": [spot("first", "Akari Ashtray", 0.001, "ashtray", "yes"),
                      spot("second", "Beni Outdoor Area", 0.002, "designatedOutdoorArea", "unknown"),
                      spot("third", "Cobalt Room", 0.003, "publicSmokingRoom", "no"),
                      spot("fourth", "Fourth Place", 0.004, "ashtray", "unknown")],
            "sources": [["id": "fixture", "displayName": "Fixture publisher",
                         "licenseName": "CC BY", "attributionText": "Fixture attribution"]]
        ]
        return try JSONSerialization.data(withJSONObject: payload).base64EncodedString()
    }

    private enum ScrollDirection { case up, down }

    @MainActor
    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication,
                                    direction: ScrollDirection = .up) {
        for _ in 0..<20 where !element.isHittable {
            let start = app.coordinate(withNormalizedOffset:
                CGVector(dx: 0.5, dy: direction == .up ? 0.78 : 0.42))
            let end = app.coordinate(withNormalizedOffset:
                CGVector(dx: 0.5, dy: direction == .up ? 0.55 : 0.65))
            start.press(forDuration: 0.01, thenDragTo: end)
        }
        if !element.isHittable {
            attach(app, named: "unreachable-\(element.identifier)")
            XCTFail("Unreachable element: \(element.identifier). Hierarchy: \(app.debugDescription)")
        }
    }

    @MainActor
    private func attach(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
