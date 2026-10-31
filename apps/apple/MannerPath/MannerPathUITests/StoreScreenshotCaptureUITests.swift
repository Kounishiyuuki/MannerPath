import XCTest
import UIKit

/// Manual-only capture of the unchanged Release UI against production. No seeded places or app hooks.
/// Run on a fresh simulator with location denied, using the documented production capture command.
@MainActor
final class StoreScreenshotCaptureUITests: MannerPathUITestCase {
    override func setUp() async throws {
        try await super.setUp()
        #if DEBUG
        throw XCTSkip("Release capture only")
        #else
        guard ProcessInfo.processInfo.environment["MP_STORE_CAPTURE"] == "1" else {
            throw XCTSkip("Manual production screenshot capture only")
        }
        #endif
    }

    private func capture(_ name: String) throws {
        assertNoDeveloperText()
        let data = try XCTUnwrap(app.screenshot().image.jpegData(compressionQuality: 1))
        let image = XCTAttachment(uniformTypeIdentifier: "public.jpeg", name: name, payload: data, userInfo: nil)
        image.lifetime = .keepAlways
        add(image)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
    }

    func testProductionDestinationScreenshots() throws {
        launch()
        XCTAssertTrue(destinationSearch.waitForExistence(timeout: 30))
        destinationSearch.tap()
        destinationSearch.typeText("上野駅 東京")
        let match = app.buttons.matching(identifier: "destinationMatch").firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: 45), "Real MapKit destination search must succeed")
        match.tap()
        XCTAssertTrue(resultRows.firstMatch.waitForExistence(timeout: 45), "Production places must load")
        // Move the native sheet using its grabber, without changing the product layout.
        let collapseTitle = app.navigationBars["近くの場所"]
        collapseTitle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
        sleep(3)
        try capture("01-covered-area-map")
        let title = app.navigationBars["近くの場所"]
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)))
        sleep(1)
        try capture("03-destination-place-list")
        destinationSearch.tap()
        destinationSearch.typeText("上野駅 東京")
        XCTAssertTrue(match.waitForExistence(timeout: 45))
        try capture("02-destination-search")
        match.tap()
        XCTAssertTrue(resultRows.firstMatch.waitForExistence(timeout: 45))
        let first = resultRows.firstMatch
        scrollTo(first, maxSwipes: 12)
        openDetail(fromRow: first)
        waitForDetail()
        let handoff = app.buttons["open-walking-directions"]
        scrollTo(handoff, maxSwipes: 12)
        try capture("05-apple-maps-handoff-control")
        // Capture the in-app control only; opening another app is not a MannerPath store screenshot.
        let source = app.buttons["情報源と法的な出典表示"]
        scrollTo(source, maxSwipes: 18)
        source.tap()
        XCTAssertTrue(app.navigationBars["情報源"].waitForExistence(timeout: 10))
        let notice = app.descendants(matching: .any)["sourceModificationNotice"].firstMatch
        scrollTo(notice, maxSwipes: 15)
        try capture("review-processing-notice")
        let license = app.descendants(matching: .any)["sourceLicenseLink"].firstMatch
        scrollTo(license, maxSwipes: 15)
        try capture("04-official-source-license")
    }
}
