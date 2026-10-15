import XCTest
import ImageIO

/// Opt-in capture only: real Release app, normal phone WatchConnectivity sync, no snapshot fixtures.
/// A spot-ID prefix is not provenance: independently match every displayed ID to live API before review.
@MainActor
final class StoreWatchCaptureUITests: XCTestCase {
    func testNormallySyncedProductionScreens() throws {
        #if DEBUG
        throw XCTSkip("Release capture only")
        #else
        guard ProcessInfo.processInfo.environment["MP_STORE_CAPTURE"] == "1" else {
            throw XCTSkip("Manual capture only")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(ja)", "-AppleLocale", "ja_JP"]
        app.launch()
        let agree = app.buttons["watch-eligibility-continue"]
        if agree.waitForExistence(timeout: 5) { agree.tap() }
        let first = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "watch-spot-sp_")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 60), "A normally synced list must exist for capture; independently verify IDs against production")
        guard first.exists else { return }
        let identity = XCTAttachment(string: first.identifier + "\n" + first.label)
        identity.name = "watch-observed-production-identity"
        identity.lifetime = .keepAlways
        add(identity)
        try capture(app, "watch-01-nearby")
        first.tap()
        try capture(app, "watch-02-detail")
        #endif
    }

    private func capture(_ app: XCUIApplication, _ name: String) throws {
        let pixels = try XCTUnwrap(CGImageSourceCreateWithData(app.screenshot().pngRepresentation as CFData, nil))
        let output = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(output, "public.jpeg" as CFString, 1, nil))
        CGImageDestinationAddImageFromSource(destination, pixels, 0, [kCGImageDestinationLossyCompressionQuality: 1] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let image = XCTAttachment(uniformTypeIdentifier: "public.jpeg", name: name, payload: output as Data, userInfo: nil)
        image.lifetime = .keepAlways
        add(image)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
    }
}
