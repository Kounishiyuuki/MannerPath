import XCTest

// v1.0 photo-report form flow against the DEBUG-only UI-test report stack (`-uiTestPhotoReport <scenario>`): a
// deployment that advertises photo intake, a fake App Attest authorizer and a scripted uploader. Needs no Worker,
// and never reaches a real report or photo endpoint. Selection/upload tests use the stack's "add test photo"
// button, which exists only in that DEBUG composition; the native picker smoke test opens and cancels without
// reading, selecting or changing library photos. These diagnostic captures are fixtures, not submission assets.
final class I_PhotoReportFlowUITests: MannerPathUITestCase {
    func openNewPlaceForm(_ scenario: String) {
        launch(extraArguments: ["-uiTestPhotoReport", scenario])
        // The entry copy can differ from the form title; use the shipped map-entry contract.
        let add = app.buttons["mapReportButton"]
        // Launch reads availability from the stack; a loaded Simulator can take well over 30 s to show the entry.
        XCTAssertTrue(add.waitForExistence(timeout: 90))
        add.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
    }

    func choosePinAndAgree() {
        app.buttons["地図でピンを選ぶ"].tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForExistence(timeout: 10))
        app.buttons["地図の中心を使用"].tap()
        let confirm = app.buttons["提案するピンを確定"]
        scrollTo(confirm)
        confirm.tap()
        let agree = app.switches["報告に関する規約に同意する"]
        scrollTo(agree)
        agree.switches.firstMatch.exists ? agree.switches.firstMatch.tap() : agree.tap()
    }

    var submit: XCUIElement { app.buttons["report.submit"] }

    func submitOnceAndWaitForReceipt(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.buttons["下書きを破棄"].exists, file: file, line: line)
        // XCTest can call a partially clipped last Form row hittable (observed y=836, h=44 on an 852pt screen).
        // Move the entire button clear of the home-indicator edge before the one and only submit tap.
        let safeFrame = app.frame.insetBy(dx: 0, dy: 44)
        for _ in 0..<4 where !safeFrame.contains(submit.frame) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.75)).press(forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.35)))
        }
        let frame = submit.frame
        guard safeFrame.contains(frame), submit.isEnabled, submit.isHittable else {
            screenshot("fixture-only-submit-clipped-not-for-submission")
            XCTFail("Submit must be fully visible before tapping. Frame: \(frame)", file: file, line: line)
            return
        }
        submit.tap()
        // Acceptance removes the draft toolbar action. Observe that transition before scrolling a reflowed Form;
        // never hide a missed action or an unresolved submission by blindly tapping submit again.
        guard app.buttons["下書きを破棄"].waitForNonExistence(timeout: 15) else {
            screenshot("fixture-only-submission-no-receipt-not-for-submission")
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "fixture-only-submission-no-receipt-tree"
            tree.lifetime = .keepAlways
            add(tree)
            XCTFail("A single submit tap did not reach receipt state. Submit frame: \(frame)", file: file, line: line)
            return
        }
    }

    func addPhotos(_ count: Int) {
        let add = app.buttons["report.photo.addTest"]
        for _ in 0..<count {
            // Photos precede consent/submit and the growing preview list.
            scrollTo(add, upwards: true)
            add.tap()
        }
    }

    func testNativePhotosPickerCancelReturnsToUnchangedForm() {
        openNewPlaceForm("success")
        choosePinAndAgree()
        let choose = app.buttons["report.photo.choose"]
        scrollTo(choose, upwards: true)
        choose.tap()
        let cancel = app.buttons.matching(NSPredicate(format: "label == 'キャンセル' OR label == 'Cancel'")).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 20), "The real system photo picker must offer cancellation")
        cancel.tap()
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].exists)
        scrollTo(choose, upwards: true)
        XCTAssertTrue(choose.isEnabled && choose.isHittable, "The form must remain usable after cancellation")
        XCTAssertFalse(app.buttons["report.photo.remove"].exists)
        XCTAssertFalse(textContaining("選択した写真").exists)
        XCTAssertFalse(textContaining("Selected photo").exists)
        scrollTo(submit)
        XCTAssertFalse(submit.isEnabled, "Cancelling must not satisfy the required photo selection")
        // Capture only the fixture form after dismissal; do not capture any existing library contents.
        screenshot("fixture-only-native-photo-picker-cancelled-not-for-submission")
    }

    func testNewPlaceRequiresPhotosThenSendsReportAndPhotos() {
        openNewPlaceForm("success")
        choosePinAndAgree()
        let required = text("写真（必須・1〜3枚）")
        scrollTo(required, upwards: true)
        scrollTo(textContaining("位置情報は使用しません"))
        scrollTo(submit)
        XCTAssertFalse(submit.isEnabled, "a new place cannot be submitted without a photo")
        screenshot("60-photo-required")
        addPhotos(3)
        XCTAssertFalse(app.buttons["report.photo.addTest"].exists, "no fourth photo can be added")
        let remove = app.buttons["report.photo.remove"].firstMatch
        scrollTo(remove)
        screenshot("61-photo-preview")
        remove.tap()
        XCTAssertEqual(app.buttons.matching(identifier: "report.photo.remove").count, 2)
        addPhotos(1)
        scrollTo(submit)
        XCTAssertTrue(submit.isEnabled)
        submitOnceAndWaitForReceipt()
        // Acceptance removes the draft/submit section. Return to the photos above the retained scroll position,
        // then continue down to the thanks copy, shown only once every photo is received.
        scrollTo(text("写真を受け付けました（審査待ち）"), upwards: true)
        let thanks = textContaining("報告ありがとうございます")
        scrollTo(thanks)
        XCTAssertFalse(app.buttons["report.photo.retry"].exists)
        screenshot("62-photo-all-sent")
    }

    func testPhotoFailureShowsReasonAndRetriesOnlyPhotos() {
        openNewPlaceForm("retry")
        choosePinAndAgree()
        addPhotos(2)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        let retry = app.buttons["report.photo.retry"]
        scrollTo(textContaining("通信の問題で写真を送信できませんでした"), upwards: true)
        scrollTo(textContaining("2枚のうち2枚が未送信"))
        XCTAssertFalse(textContaining("報告ありがとうございます").exists)
        scrollTo(retry, upwards: true)
        screenshot("63-photo-failed")
        retry.tap()
        scrollTo(textContaining("報告ありがとうございます"))
        XCTAssertFalse(retry.exists)
        screenshot("64-photo-retried")
    }

    func testExpiredReportOffersNoRetry() {
        openNewPlaceForm("expired")
        choosePinAndAgree()
        addPhotos(1)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        XCTAssertTrue(textContaining("写真を追加できる期限が過ぎました").waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["report.photo.retry"].exists)
        XCTAssertTrue(textContaining("1枚のうち1枚が未送信").exists)
        screenshot("65-photo-expired")
    }

    func testClosedPhotoIntakeBlocksNewPlaces() {
        openNewPlaceForm("closed")
        XCTAssertTrue(app.descendants(matching: .any)["report-new-spot-closed"].waitForExistence(timeout: 10))
        XCTAssertTrue(textContaining("現在、新しい喫煙所の報告を受け付けていません").exists)
        XCTAssertFalse(app.buttons["report.photo.addTest"].exists)
        screenshot("66-new-spot-closed")
        choosePinAndAgree()
        scrollTo(submit)
        XCTAssertFalse(submit.isEnabled)
    }
}
