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

    func launch(acceptingEligibility: Bool = true) {
        app.launchArguments = ["-AppleLanguages", "(ja)", "-AppleLocale", "ja_JP"]
        if acceptingEligibility {
            // Standard UserDefaults argument domain; the app's own storage is unchanged.
            app.launchArguments += ["-eligibilityNoticeAccepted", "YES"]
        }
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
    func scrollTo(_ element: XCUIElement, maxSwipes: Int = 60, file: StaticString = #filePath, line: UInt = #line) {
        var swipes = 0
        while !(element.exists && element.isHittable) && swipes < maxSwipes {
            // Drag along the left margin: a swipe from the screen centre can land on a map and pan it.
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.75))
            start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.35)))
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

    func waitForResults(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(resultRows.firstMatch.waitForExistence(timeout: 30), "No nearby results", file: file, line: line)
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
        let map = app.descendants(matching: .any)["nearbyMap"]
        XCTAssertTrue(map.exists)
        XCTAssertGreaterThanOrEqual(map.frame.height, 200, "Map is too cramped to use")
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
        scrollTo(app.buttons["Appleマップで徒歩ルートを開く"])
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

    func testMapPinOpensDetail() {
        launch()
        waitForResults()
        let pin = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'の詳細を表示'")).firstMatch
        XCTAssertTrue(pin.waitForExistence(timeout: 10))
        pin.tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
    }

    func testPhysicalTypeFilterEmptiesAndClearRestores() {
        launch()
        waitForResults()
        let before = resultRows.count
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
        XCTAssertEqual(resultRows.count, before)

        // Reopening shows the cleared state, not the earlier selection.
        app.buttons["絞り込み"].tap()
        XCTAssertTrue(app.buttons["場所の種類: 指定なし"].waitForExistence(timeout: 5))
        app.buttons["完了"].tap()
    }

    func testTobaccoFilterKeepsUnknownSupportVisible() {
        launch()
        waitForResults()
        let before = resultRows.count
        app.buttons["絞り込み"].tap()
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'たばこの種類'")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        app.buttons["紙巻き"].tap()
        app.buttons["完了"].tap()
        waitForResults()
        // Only the fixture's heated-only booth is confirmed unsupported; unknown support stays listed.
        XCTAssertEqual(resultRows.count, before - 1)
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
        XCTAssertTrue(app.buttons["審査用に送信"].exists, "Submit stays available but is never tapped here")

        app.buttons["閉じる"].tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        let resume = app.buttons["保存済みの報告を再開"]
        scrollTo(resume)
        resume.tap()
        XCTAssertTrue(app.navigationBars["場所の情報を報告"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["地図でピンを選ぶ"].exists, "Draft type survived closing")
        app.buttons["下書きを破棄"].tap()
        XCTAssertTrue(app.navigationBars["場所の詳細"].waitForExistence(timeout: 10))
        scrollTo(app.buttons["この場所の情報を報告"])
    }

    func testDestinationSearchCanBeOperated() {
        launch()
        waitForResults()
        let field = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Appleマップで目的地を検索'")).firstMatch
        scrollTo(field)
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

    func testIconOnlyActionsHaveLabels() {
        launch()
        waitForResults()
        XCTAssertTrue(app.buttons["絞り込み"].exists)
        XCTAssertTrue(app.buttons["データとプライバシー"].exists)
        XCTAssertTrue(app.buttons["更新"].exists)
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
        screenshot("12-clean-offline")
    }
}

final class E_LocationDeniedUITests: MannerPathUITestCase {
    func testDeniedOffersSettings() {
        launch()
        XCTAssertTrue(textContaining("位置情報の利用がオフです").waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["設定を開く"].exists)
        XCTAssertEqual(resultRows.count, 0)
        screenshot("13-location-denied")
    }
}

final class F_LocationNotDeterminedUITests: MannerPathUITestCase {
    func testNotDeterminedAsksOnlyThroughExplicitAction() {
        launch()
        XCTAssertTrue(app.buttons["現在地を使用"].waitForExistence(timeout: 15))
        XCTAssertEqual(resultRows.count, 0)
        screenshot("14-location-not-determined")
    }
}
