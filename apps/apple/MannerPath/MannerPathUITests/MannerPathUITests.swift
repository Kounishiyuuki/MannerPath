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
        // Pins are clustered (ADR-0015); a cluster tap zooms in until a single pin can be tapped.
        let pins = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'の詳細を表示'"))
        let clusters = app.buttons.matching(NSPredicate(format: "label ENDSWITH '件の場所'"))
        XCTAssertTrue(pins.firstMatch.waitForExistence(timeout: 10) || clusters.firstMatch.waitForExistence(timeout: 10))
        for _ in 0..<4 where !pins.allElementsBoundByIndex.contains(where: \.isHittable) {
            clusters.allElementsBoundByIndex.first(where: \.isHittable)?.tap()
            sleep(2)
        }
        let pin = try XCTUnwrap(pins.allElementsBoundByIndex.first(where: \.isHittable), "no single pin after expanding clusters")
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
